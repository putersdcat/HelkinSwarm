// Token budget tracking — triggers summarization + ContinueAsNew based on context window pressure.
// Fix: #137 — uses prompt tokens (context pressure) instead of cumulative totalTokens.
// Spec ref: 08-Orchestrator-Patterns.md, ADDENDA-06

// ---------------------------------------------------------------------------
// Model context window limits (tokens)
// ---------------------------------------------------------------------------

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'grok-4-1-fast-non-reasoning': 128_000,
  'grok-4-1-fast-reasoning': 128_000,
  'o4-mini': 200_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'text-embedding-3-large': 8_191,
};

const DEFAULT_CONTEXT_LIMIT = 128_000;
const SUMMARIZE_THRESHOLD = 0.75;
const CONTINUE_AS_NEW_THRESHOLD = 0.80;

export function getContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface TokenBudgetState {
  /** Latest prompt token count from the most recent LLM call (context pressure metric). */
  latestPromptTokens: number;
  /** Context window limit for the active model. */
  contextLimit: number;
  /** Accumulated total tokens across all turns (reporting only — not used for thresholds). */
  accumulatedTokens: number;
  /** Number of turns processed. */
  turnCount: number;
  /** Active model name. */
  model: string;
}

export function createTokenBudget(model: string, contextLimit?: number): TokenBudgetState {
  return {
    latestPromptTokens: 0,
    contextLimit: contextLimit ?? getContextLimit(model),
    accumulatedTokens: 0,
    turnCount: 0,
    model,
  };
}

/** Record the latest LLM call's token usage. Only latestPromptTokens drives thresholds. */
export function recordTokenUsage(
  state: TokenBudgetState,
  promptTokens: number,
  totalTokens: number,
): TokenBudgetState {
  return {
    ...state,
    latestPromptTokens: promptTokens,
    accumulatedTokens: state.accumulatedTokens + totalTokens,
    turnCount: state.turnCount + 1,
  };
}

/** Context pressure ratio (0–1). Based on latest prompt tokens vs context limit. */
export function getContextPressure(state: TokenBudgetState): number {
  if (state.contextLimit === 0) return 0;
  return state.latestPromptTokens / state.contextLimit;
}

/** True when context pressure >= 75% — time to summarize history. */
export function shouldSummarize(state: TokenBudgetState): boolean {
  return getContextPressure(state) >= SUMMARIZE_THRESHOLD;
}

/** True when context pressure >= 80% — must ContinueAsNew immediately. */
export function shouldContinueAsNew(state: TokenBudgetState): boolean {
  return getContextPressure(state) >= CONTINUE_AS_NEW_THRESHOLD;
}

/** Remaining tokens before hitting context limit. */
export function getRemainingTokens(state: TokenBudgetState): number {
  return Math.max(0, state.contextLimit - state.latestPromptTokens);
}

/** Alias for getContextPressure — backward compat. */
export function getUsageRatio(state: TokenBudgetState): number {
  return getContextPressure(state);
}
