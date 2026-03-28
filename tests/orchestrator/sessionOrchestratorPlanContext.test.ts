import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sessionOrchestrator plan context preservation', () => {
  it('uses plan-augmented prompt messages for all LLM follow-up calls', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    const matches = source.match(/originalMessages:\s*promptWithPlan\.messages/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(source).not.toContain('originalMessages: prompt.messages');
  });
});