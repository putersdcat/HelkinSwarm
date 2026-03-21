## Tool Budget Scaler

The tool budget (max tool calls per turn) should adapt based on conversation complexity. Simple requests get a lower budget; complex multi-step tasks get a higher budget.

**Spec ref:** `docs/ADDENDA/ADDENDA-06-Token-Budget-Tool-Budget-Scaler-Input-Canonicalization.md`

---

## Purpose

A static tool budget (e.g., always 10) is either too restrictive for complex tasks or too permissive for simple queries. The scaler uses heuristic signals to compute the right budget for each turn.

---

## Scaling Heuristics

| Heuristic | Signal | Budget Adjustment |
|-----------|--------|-----------------|
| Conversation length | `historyLength > 20` | +10 |
| Conversation length | `historyLength > 10` | +5 |
| Domains in play | `domainCount * 3` | +N*3 |
| Complex keywords | `search.*and.*delete`, `for each`, `batch`, `recursive` | +5 |
| Simple patterns | `show my inbox`, `list`, `get` | Cap at 5 |

**Base budget:** 10
**Maximum cap:** 50

---

## Implementation

**New file:** `src/orchestrator/toolBudgetScaler.ts`

```typescript
interface ToolBudgetInput {
  userMessage: string;
  conversationHistory: ChatMessage[];
  capabilitiesInPlay: string[];  // Domains of tools likely to be used
}

export function computeToolBudget(input: ToolBudgetInput): number
```

---

## Acceptance Criteria

- [ ] Budget scales between 5 and 50 based on heuristics
- [ ] Complex keyword detection works for: batch, recursive, for each, search...and...delete
- [ ] Simple patterns (show, list, get) cap budget at 5
- [ ] Domain count adds 3 per domain to budget
- [ ] History length adds 5 or 10 based on thresholds
- [ ] Hard cap of 50 is never exceeded
- [ ] Integrated into `sessionOrchestrator.ts` before tool dispatch
