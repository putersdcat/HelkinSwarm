// Benchmark harness unit tests — issue #611
// Tests the false-positive penalty logic, task corpus, and scoring.
// No real LLM calls are made in these tests.

import { describe, expect, it } from 'vitest';
import {
  loadTaskLibrary,
  filterTasks,
  sampleTasks,
  toBenchmarkTasks,
  BenchmarkTaskSchema,
} from '../../src/llm/selfTuning/benchmarkTasks.js';
import { evaluateTaskSuccess } from '../../src/llm/selfTuning/monteCarloRunner.js';
import { computeCompositeScore, SCORE_WEIGHTS } from '../../src/llm/selfTuning/evalStore.js';

// ---------------------------------------------------------------------------
// evaluateTaskSuccess — false-positive penalty + expected tool checks
// ---------------------------------------------------------------------------

describe('evaluateTaskSuccess', () => {
  it('passes no-tool task when no tools called', () => {
    expect(evaluateTaskSuccess({ id: 't1', category: 'no-tool', prompt: 'hi', expectedTools: [] }, [], '')).toBe(true);
  });

  it('fails no-tool task when any tool called', () => {
    expect(evaluateTaskSuccess(
      { id: 't2', category: 'no-tool', prompt: 'hi', expectedTools: [] },
      ['helkin_skill_search'],
      '',
    )).toBe(false);
  });

  it('fails when a forbidden tool is called even if expected tools present', () => {
    const task = {
      id: 't3',
      category: 'single-tool' as const,
      prompt: 'check my emails',
      expectedTools: ['outlook_list_emails'],
      forbiddenTools: ['helkin_skill_search'],
    };
    expect(evaluateTaskSuccess(task, ['outlook_list_emails', 'helkin_skill_search'], '')).toBe(false);
  });

  it('passes when expected tools present and no forbidden tools called', () => {
    const task = {
      id: 't4',
      category: 'single-tool' as const,
      prompt: 'check my emails',
      expectedTools: ['outlook_list_emails'],
      forbiddenTools: ['helkin_skill_search'],
    };
    expect(evaluateTaskSuccess(task, ['outlook_list_emails'], '')).toBe(true);
  });

  it('fails when expected tool is missing', () => {
    const task = {
      id: 't5',
      category: 'single-tool' as const,
      prompt: 'list github issues',
      expectedTools: ['github_search_issues'],
    };
    expect(evaluateTaskSuccess(task, ['helkin_skill_search'], '')).toBe(false);
  });

  it('penalizes real observed failure: math prompt calling outlook tools', () => {
    // Seed FP-001: corr:2bf7de0c — "2 + 2" wandered into discovery + outlook
    const task = {
      id: 'fp-001',
      category: 'no-tool' as const,
      prompt: 'What is 2 + 2?',
      expectedTools: [],
      forbiddenTools: ['helkin_skill_search', 'outlook_reply_to_latest_email', 'outlook_list_emails'],
    };
    // Before #604 fix: model called helkin_skill_search + outlook_reply_to_latest_email
    expect(evaluateTaskSuccess(task, ['helkin_skill_search', 'outlook_reply_to_latest_email'], '')).toBe(false);
    // After #604 fix: model answers directly
    expect(evaluateTaskSuccess(task, [], '')).toBe(true);
  });

  it('penalizes email task that sneaks in helkin_skill_search', () => {
    // Seed FP-004: email read should not trigger discovery
    const task = {
      id: 'fp-004',
      category: 'single-tool' as const,
      prompt: 'Check my unread email.',
      expectedTools: ['outlook_list_emails'],
      forbiddenTools: ['helkin_skill_search'],
    };
    expect(evaluateTaskSuccess(task, ['helkin_skill_search', 'outlook_list_emails'], '')).toBe(false);
    expect(evaluateTaskSuccess(task, ['outlook_list_emails'], '')).toBe(true);
  });

  it('passes multi-tool task when all expected tools called (no forbidden field)', () => {
    const task = {
      id: 'mt-001',
      category: 'multi-tool-chain' as const,
      prompt: 'Find latest email from Sarah and summarise to Teams',
      expectedTools: ['outlook_list_emails', 'teams_send_message'],
    };
    expect(evaluateTaskSuccess(task, ['outlook_list_emails', 'teams_send_message'], '')).toBe(true);
    expect(evaluateTaskSuccess(task, ['outlook_list_emails'], '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// benchmarkTasks — corpus load and schema validation
// ---------------------------------------------------------------------------

describe('benchmarkTasks corpus', () => {
  it('loadTaskLibrary returns seed tasks when no file on disk', () => {
    // The tasks file may or may not exist on disk \u2014 either way the result must be non-empty
    const library = loadTaskLibrary();
    expect(library.tasks.length).toBeGreaterThan(0);
    expect(library.version).toBeGreaterThanOrEqual(1);
  });

  it('all seed tasks pass Zod schema validation', () => {
    const library = loadTaskLibrary();
    for (const task of library.tasks) {
      expect(() => BenchmarkTaskSchema.parse(task)).not.toThrow();
    }
  });

  it('real failure seeds are present in the corpus', () => {
    const library = loadTaskLibrary();
    const ids = new Set(library.tasks.map((t) => t.id));
    expect(ids.has('fp-001')).toBe(true); // corr:2bf7de0c math prompt
    expect(ids.has('fp-002')).toBe(true); // knowledge no-tool
    expect(ids.has('fp-003')).toBe(true); // knowledge no-tool
    expect(ids.has('fp-004')).toBe(true); // email without discovery
  });

  it('fp-001 has correct forbiddenTools for the corr:2bf7de0c failure pattern', () => {
    const library = loadTaskLibrary();
    const fp001 = library.tasks.find((t) => t.id === 'fp-001');
    expect(fp001).toBeDefined();
    expect(fp001!.expectedTools).toEqual([]);
    expect(fp001!.forbiddenTools).toContain('helkin_skill_search');
    expect(fp001!.forbiddenTools).toContain('outlook_reply_to_latest_email');
  });

  it('filterTasks filters by category', () => {
    const library = loadTaskLibrary();
    const noTool = filterTasks(library.tasks, { categories: ['no-tool'] });
    expect(noTool.every((t) => t.category === 'no-tool')).toBe(true);
    expect(noTool.length).toBeGreaterThan(0);
  });

  it('filterTasks filters by difficulty', () => {
    const library = loadTaskLibrary();
    const easy = filterTasks(library.tasks, { minDifficulty: 1, maxDifficulty: 1 });
    expect(easy.every((t) => t.difficulty === 1)).toBe(true);
    expect(easy.length).toBeGreaterThan(0);
  });

  it('sampleTasks returns at most N tasks', () => {
    const library = loadTaskLibrary();
    const sample = sampleTasks(library.tasks, 3);
    expect(sample.length).toBe(3);
  });

  it('toBenchmarkTasks propagates forbiddenTools when present', () => {
    const library = loadTaskLibrary();
    const fp001Def = library.tasks.find((t) => t.id === 'fp-001')!;
    const [converted] = toBenchmarkTasks([fp001Def]);
    expect(converted.forbiddenTools).toBeDefined();
    expect(converted.forbiddenTools!.length).toBeGreaterThan(0);
  });

  it('toBenchmarkTasks omits forbiddenTools when empty', () => {
    const library = loadTaskLibrary();
    const st001Def = library.tasks.find((t) => t.id === 'st-001')!;
    const [converted] = toBenchmarkTasks([st001Def]);
    // forbiddenTools should be omitted (undefined) for tasks that don't declare any
    expect(converted.forbiddenTools).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// evalStore — scoring math (pure, no I/O)
// ---------------------------------------------------------------------------

describe('computeCompositeScore', () => {
  it('weights match spec (successRate=0.40 is the dominant factor)', () => {
    const perfectSuccess = computeCompositeScore({
      successRate: 1.0,
      avgLatencyMs: 0,
      tokenEfficiency: 1.0,
      safetyPassRate: 1.0,
      verificationPassRate: 1.0,
    });
    const zeroSuccess = computeCompositeScore({
      successRate: 0.0,
      avgLatencyMs: 0,
      tokenEfficiency: 1.0,
      safetyPassRate: 1.0,
      verificationPassRate: 1.0,
    });
    expect(perfectSuccess).toBeGreaterThan(zeroSuccess);
    // The gap should be ≥ successRate weight * 0.40
    expect(perfectSuccess - zeroSuccess).toBeCloseTo(SCORE_WEIGHTS.successRate, 2);
  });

  it('produces a value in [0, 1]', () => {
    const score = computeCompositeScore({
      successRate: 0.5,
      avgLatencyMs: 1000,
      tokenEfficiency: 0.8,
      safetyPassRate: 0.9,
      verificationPassRate: 1.0,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
