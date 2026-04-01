import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('toolDispatch duplicate mutating-call suppression', () => {
  it('suppresses identical mutating tool calls after the first successful execution in a dispatch batch', () => {
    const source = readFileSync('src/orchestrator/toolDispatchActivity.ts', 'utf8');
    const guardSource = readFileSync('src/orchestrator/toolCallGuards.ts', 'utf8');

    expect(source).toContain('const successfulMutatingFingerprints = new Set<string>();');
    expect(source).toContain('if (successfulMutatingFingerprints.has(fingerprint)) {');
    expect(source).toContain('results.push(buildDuplicateSuppressedToolResult(call));');
    expect(source).toContain('successfulMutatingFingerprints.add(buildToolCallFingerprint(call.name, call.arguments));');
    expect(guardSource).toContain('duplicate retry was suppressed');
    expect(guardSource).toContain('deliveredEarlierInTurn: true');
  });
});