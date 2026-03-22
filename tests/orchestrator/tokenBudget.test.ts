// Token budget threshold tests — pure logic, no mocks needed.
// Issue: #153 discovery

import { describe, it, expect } from 'vitest';
import {
  createTokenBudget,
  recordTokenUsage,
  getContextPressure,
  shouldSummarize,
  shouldContinueAsNew,
  getRemainingTokens,
  getContextLimit,
} from '../../src/orchestrator/tokenBudget.js';

describe('tokenBudget', () => {
  it('creates a budget with default context limit for known model', () => {
    const state = createTokenBudget('o4-mini');
    expect(state.contextLimit).toBe(200_000);
    expect(state.latestPromptTokens).toBe(0);
    expect(state.turnCount).toBe(0);
  });

  it('falls back to 128k for unknown models', () => {
    expect(getContextLimit('some-future-model')).toBe(128_000);
  });

  it('allows explicit context limit override', () => {
    const state = createTokenBudget('o4-mini', 50_000);
    expect(state.contextLimit).toBe(50_000);
  });

  it('records token usage and increments turn count', () => {
    let state = createTokenBudget('grok-4-1-fast-non-reasoning');
    state = recordTokenUsage(state, 10_000, 12_000);
    expect(state.latestPromptTokens).toBe(10_000);
    expect(state.accumulatedTokens).toBe(12_000);
    expect(state.turnCount).toBe(1);

    state = recordTokenUsage(state, 20_000, 22_000);
    expect(state.latestPromptTokens).toBe(20_000);
    expect(state.accumulatedTokens).toBe(34_000);
    expect(state.turnCount).toBe(2);
  });

  it('calculates context pressure correctly', () => {
    let state = createTokenBudget('grok-4-1-fast-non-reasoning'); // 128k limit
    state = recordTokenUsage(state, 64_000, 70_000);
    expect(getContextPressure(state)).toBe(0.5);
  });

  it('shouldSummarize triggers at 75%', () => {
    let state = createTokenBudget('grok-4-1-fast-non-reasoning');
    state = recordTokenUsage(state, 95_000, 100_000); // 95k/128k ≈ 74.2%
    expect(shouldSummarize(state)).toBe(false);

    state = recordTokenUsage(state, 96_000, 100_000); // 96k/128k = 75%
    expect(shouldSummarize(state)).toBe(true);
  });

  it('shouldContinueAsNew triggers at 80%', () => {
    let state = createTokenBudget('grok-4-1-fast-non-reasoning');
    state = recordTokenUsage(state, 102_000, 110_000); // 102k/128k ≈ 79.7%
    expect(shouldContinueAsNew(state)).toBe(false);

    state = recordTokenUsage(state, 102_400, 110_000); // 102.4k/128k = 80%
    expect(shouldContinueAsNew(state)).toBe(true);
  });

  it('getRemainingTokens returns non-negative', () => {
    let state = createTokenBudget('o4-mini'); // 200k
    state = recordTokenUsage(state, 250_000, 260_000); // over limit
    expect(getRemainingTokens(state)).toBe(0);
  });

  it('handles zero context limit gracefully', () => {
    const state = createTokenBudget('x', 0);
    expect(getContextPressure(state)).toBe(0);
  });
});
