import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('reply delivery recovery result ownership source guards', () => {
  it('does not overwrite a synthesized recovery result by unconditionally reading sessionTask.result afterward', () => {
    const overseerSource = readFileSync('src/orchestrator/overseer.ts', 'utf8');

    expect(overseerSource).toContain('let sessionResult: SessionResult | undefined;');
    expect(overseerSource).toContain('if (!sessionDone || sessionResult === undefined) {');
    expect(overseerSource).toContain('sessionResult = sessionTask.result as SessionResult;');
    expect(overseerSource).toContain('if (!sessionResult) {');
    expect(overseerSource).toContain('processTurn completed without a session result');
  });
});