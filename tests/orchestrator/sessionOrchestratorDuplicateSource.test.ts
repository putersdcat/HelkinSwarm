import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sessionOrchestrator duplicate mutating-call suppression', () => {
  it('tracks successful mutating tool fingerprints across rounds and suppresses already-succeeded replays', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('const successfulMutatingFingerprints = new Set<string>();');
    expect(source).toContain('recordSuccessfulMutatingFingerprints(');
    expect(source).toContain('buildDuplicateSuppressedToolResult(call)');
    expect(source).toContain('successfulMutatingFingerprints.has(fingerprint)');
  });
});