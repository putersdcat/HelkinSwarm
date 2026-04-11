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
import { evaluateTaskSuccess, containsExpectedAnswer } from '../../src/llm/selfTuning/monteCarloRunner.js';
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

  it('passes math task when expectedAnswer found in content', () => {
    const task = {
      id: 'math-arith-001',
      category: 'math' as const,
      prompt: 'What is 2 + 2?',
      expectedTools: [],
      expectedAnswer: '4',
    };
    expect(evaluateTaskSuccess(task, [], 'The answer is 4.')).toBe(true);
    expect(evaluateTaskSuccess(task, [], '2 + 2 equals 4')).toBe(true);
  });

  it('fails math task when expectedAnswer absent from content', () => {
    const task = {
      id: 'math-arith-001',
      category: 'math' as const,
      prompt: 'What is 2 + 2?',
      expectedTools: [],
      expectedAnswer: '4',
    };
    expect(evaluateTaskSuccess(task, [], 'I think it might be 5.')).toBe(false);
    expect(evaluateTaskSuccess(task, [], '')).toBe(false);
  });

  it('fails math task when correct answer given but forbidden tool also called', () => {
    const task = {
      id: 'math-arith-001',
      category: 'math' as const,
      prompt: 'What is 2 + 2?',
      expectedTools: [],
      forbiddenTools: ['helkin_skill_search'],
      expectedAnswer: '4',
    };
    expect(evaluateTaskSuccess(task, ['helkin_skill_search'], 'The answer is 4.')).toBe(false);
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
// containsExpectedAnswer — deterministic math answer checker (#436)
// ---------------------------------------------------------------------------

describe('containsExpectedAnswer', () => {
  it('matches exact substring', () => {
    expect(containsExpectedAnswer('The answer is 4.', '4')).toBe(true);
    expect(containsExpectedAnswer('Result: 221', '221')).toBe(true);
  });

  it('matches answer embedded in prose', () => {
    expect(containsExpectedAnswer('2 + 2 equals 4 in decimal arithmetic.', '4')).toBe(true);
    expect(containsExpectedAnswer('x = 5 is the solution.', '5')).toBe(true);
  });

  it('does not match a number that is only a substring of a larger number', () => {
    // "4" must not match "40" or "14"
    expect(containsExpectedAnswer('The answer is 40.', '4')).toBe(false);
    expect(containsExpectedAnswer('Result: 14', '4')).toBe(false);
  });

  it('is case-insensitive for string answers', () => {
    expect(containsExpectedAnswer('The answer is FOUR', 'four')).toBe(true);
  });

  it('returns false when content is empty', () => {
    expect(containsExpectedAnswer('', '4')).toBe(false);
  });

  it('returns false for wrong numeric answer', () => {
    expect(containsExpectedAnswer('The answer is 5.', '4')).toBe(false);
  });

  it('matches decimal forms: "62.1" in prose output', () => {
    expect(containsExpectedAnswer('100 km is approximately 62.1 miles.', '62.1')).toBe(true);
    expect(containsExpectedAnswer('The conversion gives 62.1 miles.', '62.1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math benchmark corpus (#436)
// ---------------------------------------------------------------------------

describe('math benchmark corpus', () => {
  it('corpus contains all five math categories as tags', () => {
    const library = loadTaskLibrary();
    const mathTasks = filterTasks(library.tasks, { categories: ['math'] });
    const tags = new Set(mathTasks.flatMap((t) => t.tags));
    expect(tags.has('arithmetic')).toBe(true);
    expect(tags.has('algebra')).toBe(true);
    expect(tags.has('unit-conversion')).toBe(true);
    expect(tags.has('discrete')).toBe(true);
    expect(tags.has('word-problem')).toBe(true);
  });

  it('every math task has an expectedAnswer set', () => {
    const library = loadTaskLibrary();
    const mathTasks = filterTasks(library.tasks, { categories: ['math'] });
    expect(mathTasks.length).toBeGreaterThanOrEqual(15);
    for (const task of mathTasks) {
      expect(task.expectedAnswer).toBeDefined();
      expect(task.expectedAnswer).not.toBe('');
    }
  });

  it('every math task has expectedTools=[] (no tool calls required)', () => {
    const library = loadTaskLibrary();
    const mathTasks = filterTasks(library.tasks, { categories: ['math'] });
    for (const task of mathTasks) {
      expect(task.expectedTools).toEqual([]);
    }
  });

  it('every math task has at least one forbiddenTool (guards against false-positive routing)', () => {
    const library = loadTaskLibrary();
    const mathTasks = filterTasks(library.tasks, { categories: ['math'] });
    for (const task of mathTasks) {
      expect(task.forbiddenTools?.length).toBeGreaterThan(0);
    }
  });

  it('all math tasks pass Zod schema validation', () => {
    const library = loadTaskLibrary();
    const mathTasks = filterTasks(library.tasks, { categories: ['math'] });
    for (const task of mathTasks) {
      expect(() => BenchmarkTaskSchema.parse(task)).not.toThrow();
    }
  });

  it('toBenchmarkTasks propagates expectedAnswer for math tasks', () => {
    const library = loadTaskLibrary();
    const mathDef = library.tasks.find((t) => t.id === 'math-arith-001');
    expect(mathDef).toBeDefined();
    const [converted] = toBenchmarkTasks([mathDef!]);
    expect(converted.expectedAnswer).toBe('4');
  });

  it('specific math answers are correct: 17x13=221, 5!=120, C(5,2)=10', () => {
    const library = loadTaskLibrary();
    const taskMap = new Map(library.tasks.map((t) => [t.id, t]));
    expect(taskMap.get('math-arith-002')?.expectedAnswer).toBe('221');
    expect(taskMap.get('math-disc-001')?.expectedAnswer).toBe('120');
    expect(taskMap.get('math-disc-002')?.expectedAnswer).toBe('10');
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
