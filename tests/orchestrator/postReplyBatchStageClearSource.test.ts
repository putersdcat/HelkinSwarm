import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('[#704] postReplyBatchActivity stage tracker cleanup', () => {
  const source = readFileSync('src/orchestrator/postReplyBatchActivity.ts', 'utf8');

  it('imports clearOrchestratorStage alongside recordSubstage', () => {
    // Both imports must come from the same orchestratorStageHealth module so
    // the finally block can drain the in-memory activeTurns entry that
    // recordSubstage created at the top of the handler.
    expect(source).toMatch(
      /import\s*\{[^}]*recordSubstage[^}]*clearOrchestratorStage[^}]*\}\s*from\s*'\.\.\/observability\/orchestratorStageHealth\.js'/,
    );
  });

  it('records the post-reply-batch substage once at the top of the handler', () => {
    const matches = source.match(/recordSubstage\(input\.correlationId,\s*'post-reply-batch'/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('wraps the Promise.allSettled batch in try { ... } finally so stage cleanup runs on every exit path', () => {
    // The batch body starts with Promise.allSettled and the try must enclose it.
    const tryStart = source.indexOf('try {');
    const allSettledIdx = source.indexOf('Promise.allSettled');
    const finallyIdx = source.indexOf('} finally {');
    expect(tryStart).toBeGreaterThan(-1);
    expect(allSettledIdx).toBeGreaterThan(tryStart);
    expect(finallyIdx).toBeGreaterThan(allSettledIdx);
  });

  it('calls clearOrchestratorStage inside the finally with the turn identifiers', () => {
    const finallyBlock = source.slice(source.indexOf('} finally {'));
    expect(finallyBlock).toContain('clearOrchestratorStage(input.correlationId, input.userId)');
    // Must be awaited so the orchestrator sees the cleared in-memory map entry
    // before the next ingress-window activity fires.
    expect(finallyBlock).toMatch(/await\s+clearOrchestratorStage\(/);
  });

  it('logs a warning when clearOrchestratorStage throws so we never swallow silently', () => {
    const finallyBlock = source.slice(source.indexOf('} finally {'));
    expect(finallyBlock).toContain('[postReplyBatchActivity] clearOrchestratorStage failed');
  });
});
