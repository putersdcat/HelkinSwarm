import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('[#705] swarmWorkerActivity stage tracker cleanup', () => {
  const source = readFileSync('src/orchestrator/swarm/swarmWorkerActivity.ts', 'utf8');

  it('imports clearOrchestratorStage alongside recordOrchestratorStage', () => {
    // Both imports must come from the same orchestratorStageHealth module so
    // the finally block can drain the swarm-workers stage entry that
    // recordOrchestratorStage created at the top of the handler.
    expect(source).toMatch(
      /import\s*\{[^}]*recordOrchestratorStage[^}]*clearOrchestratorStage[^}]*\}\s*from\s*'\.\.\/\.\.\/observability\/orchestratorStageHealth\.js'/,
    );
  });

  it('records the swarm-workers stage once at the top of the handler', () => {
    const matches = source.match(/recordOrchestratorStage\(input\.correlationId,\s*'swarm-workers'/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('wraps the worker loop in try { ... } catch { ... } finally so stage cleanup runs on every exit path', () => {
    const tryIdx = source.indexOf('try {');
    const catchIdx = source.indexOf('} catch (err) {', tryIdx);
    const finallyIdx = source.indexOf('} finally {', catchIdx);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(tryIdx);
    expect(finallyIdx).toBeGreaterThan(catchIdx);
  });

  it('calls clearOrchestratorStage inside the finally with the turn identifiers', () => {
    const finallyBlock = source.slice(source.lastIndexOf('} finally {'));
    expect(finallyBlock).toContain('clearOrchestratorStage(input.correlationId, input.userId)');
    expect(finallyBlock).toMatch(/await\s+clearOrchestratorStage\(/);
  });

  it('logs a warning when clearOrchestratorStage throws so we never swallow silently', () => {
    const finallyBlock = source.slice(source.lastIndexOf('} finally {'));
    expect(finallyBlock).toContain('[swarmWorkerActivity] clearOrchestratorStage failed');
  });
});
