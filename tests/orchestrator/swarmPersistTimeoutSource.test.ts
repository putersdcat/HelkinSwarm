import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('swarm persist durable timeout guard', () => {
  it('bounds persistSwarmResultActivity from the session orchestrator with a Durable timer', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('SWARM_PERSIST_DURABLE_TIMEOUT_MS');
    expect(source).toContain('function* withSwarmPersistTimeout(');
    expect(source).toContain("callActivity('persistSwarmResultActivity', input)");
    expect(source).toContain("persistSwarmResultActivity timed out after");
  });
});
