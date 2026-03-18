// Token budget tracking — triggers summarization + ContinueAsNew at 80% threshold.
// Spec ref: 08-Orchestrator-Patterns.md

export interface TokenBudgetState {
  totalTokens: number;
  maxTokens: number;
  turnCount: number;
}

const DEFAULT_MAX_TOKENS = 128_000;
const THRESHOLD_RATIO = 0.8;

export function createTokenBudget(maxTokens = DEFAULT_MAX_TOKENS): TokenBudgetState {
  return { totalTokens: 0, maxTokens, turnCount: 0 };
}

export function addTokens(state: TokenBudgetState, tokens: number): TokenBudgetState {
  return {
    ...state,
    totalTokens: state.totalTokens + tokens,
    turnCount: state.turnCount + 1,
  };
}

export function shouldSummarize(state: TokenBudgetState): boolean {
  return state.totalTokens >= state.maxTokens * THRESHOLD_RATIO;
}

export function getRemainingTokens(state: TokenBudgetState): number {
  return Math.max(0, state.maxTokens - state.totalTokens);
}

export function getUsageRatio(state: TokenBudgetState): number {
  return state.totalTokens / state.maxTokens;
}
