// Self-Tuning Evaluation Loop — orchestrates discovery → hypothesis → benchmark → promote.
// Spec ref: 0m-Agentic-Tooling-Evaluation.md §4 — Self-Tuning Evaluation Loop
// Issue #96

import { randomUUID } from 'node:crypto';
import { loadModelProfile, listAvailableProfiles } from '../profileLoader.js';
import { generateCandidates, type CandidateMask, type DiscoveryReport } from './hypothesisGenerator.js';
import {
  computeCompositeScore,
  recordEvalResult,
  type EvalScore,
  type EvalResult,
} from './evalStore.js';
import { checkRegression, type RegressionCheckResult } from './regressionGuard.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkTask {
  /** Task ID */
  id: string;
  /** What this task tests (e.g. "multi-tool-chain", "single-tool-call") */
  category: string;
  /** The user prompt to test */
  prompt: string;
  /** Expected tool invocation(s) */
  expectedTools: string[];
  /**
   * Tools that must NOT be called — a call to any of these counts as a
   * false-positive failure even if all expectedTools are also present.
   * Issue #611: harness must penalize wrong-tool false positives.
   */
  forbiddenTools?: string[];
}

/** Result of benchmarking a single candidate */
export interface CandidateBenchmarkResult {
  candidate: CandidateMask;
  scores: EvalScore;
  compositeScore: number;
  taskResults: TaskResult[];
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  latencyMs: number;
  tokensUsed: number;
  toolsCalled: string[];
  safetyPassed: boolean;
  verificationPassed: boolean;
}

/** The benchmark runner function — provided by the caller (or #97's framework) */
export type BenchmarkRunner = (
  candidate: CandidateMask,
  tasks: BenchmarkTask[],
) => Promise<CandidateBenchmarkResult>;

export interface EvalLoopConfig {
  /** Models to evaluate (defaults to all available profiles) */
  models?: string[];
  /** Discovery reports (from DEVQUERY: probe_limits) — optional */
  discoveryReports?: Map<string, DiscoveryReport>;
  /** The benchmark runner implementation */
  runBenchmark: BenchmarkRunner;
  /** Tasks to run */
  tasks: BenchmarkTask[];
  /** Callback when a regression is detected */
  onRegression?: (result: RegressionCheckResult, modelId: string) => Promise<void>;
  /** Callback when a new profile is promoted */
  onPromotion?: (modelId: string, result: EvalResult, candidate: CandidateMask) => Promise<void>;
}

export interface EvalLoopResult {
  /** Per-model results */
  models: ModelEvalSummary[];
  /** Total elapsed time in ms */
  totalMs: number;
}

export interface ModelEvalSummary {
  model: string;
  candidates: CandidateBenchmarkResult[];
  winner: CandidateBenchmarkResult | null;
  promoted: boolean;
  regression: RegressionCheckResult | null;
}

// ---------------------------------------------------------------------------
// Main Loop
// ---------------------------------------------------------------------------

/**
 * Run the self-tuning evaluation loop for all configured models.
 * Workflow: Discovery → Hypothesis → Benchmark → Score → Promote → Guard
 */
export async function runEvalLoop(config: EvalLoopConfig): Promise<EvalLoopResult> {
  const startTime = Date.now();
  const models = config.models ?? listAvailableProfiles();
  const summaries: ModelEvalSummary[] = [];

  for (const modelId of models) {
    const summary = await evaluateModel(modelId, config);
    summaries.push(summary);
  }

  return {
    models: summaries,
    totalMs: Date.now() - startTime,
  };
}

async function evaluateModel(
  modelId: string,
  config: EvalLoopConfig,
): Promise<ModelEvalSummary> {
  const baseProfile = loadModelProfile(modelId);

  if (!baseProfile) {
    return {
      model: modelId,
      candidates: [],
      winner: null,
      promoted: false,
      regression: null,
    };
  }

  // Step 1: Generate candidates using discovery report (or null)
  const discovery = config.discoveryReports?.get(modelId) ?? null;
  const candidates = generateCandidates(baseProfile, discovery);

  // Step 2: Benchmark each candidate
  const results: CandidateBenchmarkResult[] = [];
  for (const candidate of candidates) {
    const result = await config.runBenchmark(candidate, config.tasks);
    results.push(result);
  }

  // Step 3: Pick winner (highest composite score)
  const winner = results.length > 0
    ? results.reduce((best, r) => r.compositeScore > best.compositeScore ? r : best)
    : null;

  // Step 4: Record result and check regression
  let regression: RegressionCheckResult | null = null;
  let promoted = false;

  if (winner) {
    const evalResult: EvalResult = {
      runId: randomUUID(),
      model: modelId,
      profileVersion: baseProfile.version,
      timestamp: new Date().toISOString(),
      taskCount: config.tasks.length,
      compositeScore: winner.compositeScore,
      scores: winner.scores,
      promoted: false,
      candidateName: winner.candidate.name,
    };

    // Check regression against baseline
    regression = checkRegression(modelId, evalResult);

    if (regression.regressed) {
      // Don't promote — notify caller for rollback
      evalResult.notes = `Regression detected: ${regression.summary}`;
      recordEvalResult(modelId, evalResult);

      if (config.onRegression) {
        await config.onRegression(regression, modelId);
      }
    } else {
      // Promote winner
      evalResult.promoted = true;
      promoted = true;
      recordEvalResult(modelId, evalResult);

      if (config.onPromotion) {
        await config.onPromotion(modelId, evalResult, winner.candidate);
      }
    }
  }

  return {
    model: modelId,
    candidates: results,
    winner,
    promoted,
    regression,
  };
}

// ---------------------------------------------------------------------------
// Utility — aggregate task results into scores
// ---------------------------------------------------------------------------

/** Aggregate individual task results into an EvalScore */
export function aggregateTaskResults(taskResults: TaskResult[]): EvalScore {
  if (taskResults.length === 0) {
    return {
      successRate: 0,
      avgLatencyMs: 0,
      tokenEfficiency: 0,
      safetyPassRate: 0,
      verificationPassRate: 0,
    };
  }

  const n = taskResults.length;
  const successRate = taskResults.filter(t => t.success).length / n;
  const avgLatencyMs = taskResults.reduce((s, t) => s + t.latencyMs, 0) / n;
  const totalTokens = taskResults.reduce((s, t) => s + t.tokensUsed, 0);
  const avgTokensPerTask = totalTokens / n;
  // Token efficiency: assume 500 tokens per task is optimal, >2000 is wasteful
  const tokenEfficiency = Math.max(0, Math.min(1, 1 - (avgTokensPerTask - 500) / 1500));
  const safetyPassRate = taskResults.filter(t => t.safetyPassed).length / n;
  const verificationPassRate = taskResults.filter(t => t.verificationPassed).length / n;

  return {
    successRate,
    avgLatencyMs,
    tokenEfficiency,
    safetyPassRate,
    verificationPassRate,
  };
}

/** Convenience: compute composite from task results */
export function scoreFromTasks(taskResults: TaskResult[]): {
  scores: EvalScore;
  compositeScore: number;
} {
  const scores = aggregateTaskResults(taskResults);
  return { scores, compositeScore: computeCompositeScore(scores) };
}
