import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop active-turn proof surface', () => {
  it('exposes an owner-only helper to seed and clear synthetic active-turn stage docs', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain("route: 'devloop/active-turns'");
    expect(source).toContain("authLevel: 'function'");
    expect(source).toContain("action: z.literal('seed')");
    expect(source).toContain("action: z.literal('clear')");
    expect(source).toContain('await recordOrchestratorStage(correlationId, body.stage, userId);');
    expect(source).toContain('await clearOrchestratorStage(correlationId, userId);');
    expect(source).toContain('const activeTurnCount = await getActiveTurnCountForUser(userId);');
  });
});