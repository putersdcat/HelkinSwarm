import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sessionOrchestrator plan context preservation', () => {
  it('uses plan-augmented prompt messages for all LLM follow-up calls', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    const matches = source.match(/originalMessages:\s*promptWithPlan\.messages/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(source).not.toContain('originalMessages: prompt.messages');
  });

  it('tracks completed plan steps and constrains dispatch to ready planned calls first', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('let completedPlanStepOrders: number[] = [];');
    expect(source).toContain('selectReadyToolCallsByPlan(');
    expect(source).toContain('collectCompletedPlanStepOrders(');
  });

  it('can bypass the first follow-up model call when discovery already identified an explicit send tool', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('const deterministicFollowUpToolCall = synthesizeDeterministicFollowUpToolCall(');
    expect(source).toContain("let followUp: LlmResult = deterministicFollowUpToolCall");
    expect(source).toContain("finishReason: 'tool_calls'");
  });

  it('forces a text-only wrap-up after a successful high-risk follow-up action', () => {
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain("const shouldForceFinalTextResponse = highestRoundRisk === 'high'");
    expect(source).toContain('const allowMoreFollowUpTools = !isLastRound && !shouldForceFinalTextResponse;');
    expect(source).toContain('enableRetry: allowMoreFollowUpTools');
  });
});