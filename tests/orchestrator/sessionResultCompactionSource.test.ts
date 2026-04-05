import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('session result compaction source guards', () => {
  it('strips arbitrary raw tool result bodies before handing the session result back to the parent overseer', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('function summarizeToolResultsForSessionResult(');
    expect(source).toContain('toolResults: summarizeToolResultsForSessionResult(toolResults),');
    expect(source).toContain('toolCallId: result.toolCallId,');
    expect(source).toContain('toolName: result.toolName,');
    expect(source).toContain('success: result.success,');
    expect(source).not.toContain('result: result.result');
  });
});