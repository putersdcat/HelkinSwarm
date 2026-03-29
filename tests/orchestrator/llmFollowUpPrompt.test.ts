import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('llmFollowUpActivity execution prompt', () => {
  it('adds an explicit continue-until-complete instruction when retry tools are enabled', () => {
    const source = readFileSync('src/orchestrator/llmFollowUpActivity.ts', 'utf8');

    expect(source).toContain('Do not stop at intermediate retrieval results');
    expect(source).toContain("If the request is not yet fulfilled and more tools are available, call the next required tool.");
    expect(source).toContain('input.enableRetry && input.tools?.length');
  });

  it('preserves follow-up tool calls even when the model also returns text', () => {
    const source = readFileSync('src/orchestrator/llmFollowUpActivity.ts', 'utf8');

    expect(source).toContain('if (retryToolCalls.length > 0 && retryTools)');
    expect(source).not.toContain('if (!llmContent && retryToolCalls.length > 0 && retryTools)');
  });
});