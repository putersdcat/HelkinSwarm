import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sessionOrchestrator duplicate tool-call suppression', () => {
  it('tracks successful mutating fingerprints and replayable read-only results across rounds', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('const successfulMutatingFingerprints = new Set<string>();');
    expect(source).toContain('const successfulReplayableReadOnlyResults = new Map<string, ToolDispatchResult[\'results\'][number]>();');
    expect(source).toContain('recordSuccessfulMutatingFingerprints(');
    expect(source).toContain('recordSuccessfulReplayableReadOnlyResults(');
    expect(source).toContain('buildDuplicateSuppressedToolResult(call)');
    expect(source).toContain('buildDuplicateReplayedToolResult(call, priorResult)');
    expect(source).toContain('successfulMutatingFingerprints.has(fingerprint)');
    expect(source).toContain('successfulReplayableReadOnlyResults.has(fingerprint)');
    expect(source).toContain('enableRetry: false,');
  });
});