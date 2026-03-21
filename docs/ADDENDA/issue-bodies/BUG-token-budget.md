## Bug: Token Budget Uses Cumulative Completion Tokens Instead of Prompt Token Context Pressure

**Issue:** #41 is closed as completed, but the token budget implementation uses the wrong metric. It accumulates `totalTokens` (completion tokens from LLM responses) rather than measuring context window pressure from prompt tokens. Completion tokens do not consume the context window — only prompt tokens do.

**Spec ref:** `docs/ADDENDA/ADDENDA-06-Token-Budget-Tool-Budget-Scaler-Input-Canonicalization.md`

---

## The Bug

### Current Implementation (`src/orchestrator/tokenBudget.ts`)

```typescript
export function addTokens(state: TokenBudgetState, tokens: number): TokenBudgetState {
  return {
    ...state,
    totalTokens: state.totalTokens + tokens,  // BUG: this is completion tokens, not prompt pressure
    turnCount: state.turnCount + 1,
  };
}
```

The overseer calls `addTokens(tokenBudget, sessionResult.tokensUsed)` where `tokensUsed` is the completion token count from the LLM response. Completion tokens do NOT add to context window pressure.

### Correct Implementation

The context window pressure is determined solely by the **prompt tokens** — the tokens sent TO the model, not received FROM it. The correct metric tracks `_latestPromptTokens` and measures it against the model's context window limit:

```typescript
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "grok-4-1-fast-reasoning": 131072,
  "gpt-4o": 128000,
  "o3": 200000,
  // ...
};

export function getContextPressure(state: TokenBudgetState): number {
  const limit = MODEL_CONTEXT_LIMITS[state.model] ?? 128000;
  return state._latestPromptTokens / limit;  // Correct metric
}

export function shouldSummarize(state: TokenBudgetState): boolean {
  return getContextPressure(state) >= 0.75;
}

export function shouldContinueAsNew(state: TokenBudgetState): boolean {
  return getContextPressure(state) >= 0.80;
}
```

### Why This Matters

1. **Completion tokens don't consume context** — The context window holds the prompt + generated tokens. Only the prompt adds to pressure.
2. **Cumulative counter grows unbounded** — Even after `ContinueAsNew` resets the counter, the next turn's completion tokens immediately add to the counter.
3. **Wrong threshold triggers** — A verbose conversation where the LLM generates long responses will accumulate high `totalTokens` even with a short context, potentially triggering `ContinueAsNew` inappropriately.

---

## Required Changes

1. Replace `totalTokens: number` with `_latestPromptTokens: number` in `TokenBudgetState`
2. Replace `addTokens()` logic with `record()` that stores only the latest prompt token count
3. Add `_accumulatedTokens: number` for reporting purposes only (not for threshold decisions)
4. Add `model: string` to state so context window limit can be looked up per-model
5. Replace `shouldSummarize()` and `shouldContinueAsNew()` with pressure-based thresholds
6. Update `overseer.ts` to pass `promptTokens` from LLM result, not `totalTokens`

---

## Acceptance Criteria

- [ ] `TokenBudgetState` uses `_latestPromptTokens` as the threshold metric
- [ ] `shouldSummarize()` fires at 75% context pressure (model-specific limit)
- [ ] `shouldContinueAsNew()` fires at 80% context pressure
- [ ] `overseer.ts` passes `promptTokens` from LLM response, not completion tokens
- [ ] Model-specific context limits are defined for all active models
- [ ] `_accumulatedTokens` is tracked separately for reporting only
- [ ] Unit tests cover all model-specific limits
