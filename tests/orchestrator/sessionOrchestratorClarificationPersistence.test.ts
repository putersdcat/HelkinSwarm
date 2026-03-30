import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sessionOrchestrator clarification persistence', () => {
  it('persists cleared pending clarification before resumed work can wait on confirmation', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('let persistClarificationClearBeforeLongRunningWork = false;');
    expect(source).toContain("persistClarificationClearBeforeLongRunningWork = true;");
    expect(source).toContain("callActivity('saveStateActivity'");
    expect(source).toContain('pendingClarification: undefined,');
  });
});