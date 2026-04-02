import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop push routing proof surface', () => {
  it('returns deliveredToOverseer and instanceId in the live response payload', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain('deliveredToOverseer: activeOverseerInstanceId !== undefined,');
    expect(source).toContain('instanceId: activeOverseerInstanceId ?? null,');
  });
});