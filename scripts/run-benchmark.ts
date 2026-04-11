#!/usr/bin/env tsx
// Local benchmark runner — Tier A evaluation, no deploy per candidate.
// Issue: #611
//
// Usage:
//   pnpm tsx scripts/run-benchmark.ts
//   pnpm tsx scripts/run-benchmark.ts --model x-ai/grok-4.1-fast
//   pnpm tsx scripts/run-benchmark.ts --count 5 --reps 1
//   pnpm tsx scripts/run-benchmark.ts --category no-tool,single-tool
//
// Requirements:
//   - LLM_PROVIDER=openrouter + OPENROUTER_API_KEY
//     OR  AZURE_AI_FOUNDRY_ENDPOINT + Azure credential in env
//   - Run `pnpm build` first (or rely on tsx's on-the-fly compilation)

import { runEvalLoop } from '../src/llm/selfTuning/evalLoop.js';
import { createMonteCarloRunner } from '../src/llm/selfTuning/monteCarloRunner.js';
import { loadTaskLibrary, toBenchmarkTasks, filterTasks, sampleTasks } from '../src/llm/selfTuning/benchmarkTasks.js';
import { listAvailableProfiles } from '../src/llm/profileLoader.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  model?: string;
  count?: number;
  reps: number;
  categories?: string[];
  verbose: boolean;
} {
  const args = argv.slice(2);
  const result: { model?: string; count?: number; reps: number; categories?: string[]; verbose: boolean } = {
    reps: 3,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model' && args[i + 1]) {
      result.model = args[++i];
    } else if (arg === '--count' && args[i + 1]) {
      result.count = parseInt(args[++i], 10);
    } else if (arg === '--reps' && args[i + 1]) {
      result.reps = parseInt(args[++i], 10);
    } else if (arg === '--category' && args[i + 1]) {
      result.categories = args[++i].split(',');
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pretty-print helpers
// ---------------------------------------------------------------------------

function bar(score: number, width = 20): string {
  const filled = Math.round(score * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function pct(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const startMs = Date.now();

  console.log('');
  console.log('HelkinSwarm Benchmark Harness — Tier A Local Runner');
  console.log('Issue: #611 | No deploy required');
  console.log('════════════════════════════════════════════════════');

  // Load and optionally filter the task corpus
  const library = loadTaskLibrary();
  let taskDefs = library.tasks;

  if (opts.categories) {
    taskDefs = filterTasks(taskDefs, { categories: opts.categories });
    console.log(`Task filter: categories=[${opts.categories.join(', ')}]`);
  }

  const sampled = opts.count ? sampleTasks(taskDefs, opts.count) : taskDefs;
  const tasks = toBenchmarkTasks(sampled);

  // Detect models
  const models = opts.model ? [opts.model] : listAvailableProfiles();
  if (models.length === 0) {
    console.error('ERROR: No model profiles found in model-profiles/. Run `pnpm build` first.');
    process.exit(1);
  }

  console.log(`Models:  ${models.join(', ')}`);
  console.log(`Tasks:   ${tasks.length} (${sampled.length} task defs)`);
  console.log(`Reps:    ${opts.reps} per task`);
  console.log('');

  const runner = createMonteCarloRunner({ repetitions: opts.reps, concurrency: 3, timeoutMs: 30_000 });

  const result = await runEvalLoop({
    models,
    runBenchmark: runner,
    tasks,
    onRegression: async (r, modelId) => {
      console.log(`⚠  REGRESSION on ${modelId}: ${r.summary}`);
    },
    onPromotion: async (modelId, evalResult) => {
      console.log(`✓  PROMOTED ${modelId} — score ${pct(evalResult.compositeScore)}`);
    },
  });

  // Print summary table
  console.log('Results');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log(
    'Model'.padEnd(35) +
    'Score'.padEnd(10) +
    'Success'.padEnd(12) +
    'Safety'.padEnd(10) +
    'Promoted',
  );
  console.log('─'.repeat(70));

  for (const summary of result.models) {
    if (!summary.winner) {
      console.log(`${summary.model.padEnd(35)} — no profile —`);
      continue;
    }
    const w = summary.winner;
    console.log(
      summary.model.padEnd(35) +
      `${bar(w.compositeScore)} ${pct(w.compositeScore)}`.padEnd(35) +
      pct(w.scores.successRate).padEnd(12) +
      pct(w.scores.safetyPassRate).padEnd(10) +
      (summary.promoted ? '✓' : '—'),
    );

    if (opts.verbose) {
      for (const tr of w.taskResults) {
        const mark = tr.success ? '  ✓' : '  ✗';
        const tools = tr.toolsCalled.length > 0 ? `tools: ${tr.toolsCalled.join(', ')}` : 'no tools';
        console.log(`${mark} [${tr.taskId}] ${tools} | ${tr.latencyMs.toFixed(0)}ms`);
      }
    }
  }

  console.log('─'.repeat(70));
  console.log(`Total elapsed: ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
  console.log('');
}

main().catch((err: unknown) => {
  console.error('Benchmark failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
