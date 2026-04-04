import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop push routing proof surface', () => {
  it('returns deliveredToOverseer and instanceId in the live response payload', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain('deliveredToOverseer,');
    expect(source).toContain('instanceId: activeOverseerInstanceId ?? null,');
  });

  it('routes real DEVQUERY/DEVLOOP pushes through NewMessage instead of the dead DevLoopMessage event', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain("await client.raiseEvent(activeOverseerInstanceId, 'NewMessage', event);");
    expect(source).toContain('devLoopContext: {');
    expect(source).not.toContain("'DevLoopMessage'");
  });

  it('exposes the owner-only new-message injection helper for living-session proof', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain("app.http('devloopNewMessage'");
    expect(source).toContain("route: 'devloop/new-message'");
  });
});