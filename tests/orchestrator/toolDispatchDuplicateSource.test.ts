import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('toolDispatch duplicate tool-call suppression', () => {
  it('suppresses identical mutating calls and replays identical read-only calls after the first successful execution in a batch', () => {
    const source = readFileSync('src/orchestrator/toolDispatchActivity.ts', 'utf8');
    const guardSource = readFileSync('src/orchestrator/toolCallGuards.ts', 'utf8');

    expect(source).toContain('const successfulMutatingFingerprints = new Set<string>();');
    expect(source).toContain('const successfulReplayableReadOnlyResults = new Map<string, ToolDispatchResult[\'results\'][number]>();');
    expect(source).toContain('if (successfulMutatingFingerprints.has(fingerprint)) {');
    expect(source).toContain('results.push(buildDuplicateSuppressedToolResult(call));');
    expect(source).toContain('const previousResult = successfulReplayableReadOnlyResults.get(fingerprint);');
    expect(source).toContain('results.push(buildDuplicateReplayedToolResult(call, previousResult));');
    expect(source).toContain('successfulMutatingFingerprints.add(fingerprint);');
    expect(source).toContain('successfulReplayableReadOnlyResults.set(fingerprint, results[results.length - 1]!);');
    expect(guardSource).toContain('duplicate retry was suppressed');
    expect(guardSource).toContain('deliveredEarlierInTurn: true');
    expect(guardSource).toContain('buildDuplicateReplayedToolResult');
  });
});