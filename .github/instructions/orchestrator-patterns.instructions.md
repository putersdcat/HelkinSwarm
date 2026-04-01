---
applyTo: "src/orchestrator/**"
---

# Orchestrator Patterns Rules
**Spec ref:** `docs/08-Orchestrator-Patterns.md`, `docs/0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md`, `docs/0t-Idempotency-and-External-Side-Effects.md`

## Critical Rule
The orchestrator must remain **completely deterministic**. Every side-effect — LLM calls, tool execution, reply sending, hook registration — must be an **activity function**. No I/O of any kind in orchestrator code.

## Eternal Overseer (`src/orchestrator/overseer.ts`)
- The only permanent Durable instance — it never ends
- Processes one message, then calls `context.df.continueAsNew()` to restart with carried-over summary
- Tracks token budget: if ≥ 80%, summarize history + inject relevant skill memory → restart immediately
- Drains all pending external events **before** restarting
- External events: `NewMessage`, `ConfirmationResponse`, durable hook callbacks

## Session Sub-Orchestrator (`src/orchestrator/sessionOrchestrator.ts`)
- Handles **one complete turn**
- Loads just-in-time skill memory vaults (0i)
- Applies Hydra-Net multimodal embeddings if needed (0k)
- Builds the prompt (persona + history + tools + model profile)
- Calls the LLM via `llmActivity.ts`
- Dispatches tool calls via `toolDispatchActivity.ts`
- Runs the full safety/verification pipeline (0e)
- Registers durable hooks for open-ended workflows (0h)
- Never calls the LLM directly — always through an activity

## Key Files

| File | Responsibility |
|------|----------------|
| `src/orchestrator/overseer.ts` | Eternal loop + ContinueAsNew |
| `src/orchestrator/sessionOrchestrator.ts` | One-turn sub-orchestration |
| `src/orchestrator/buildPromptActivity.ts` | Prompt assembly with skill memory + Hydra-Net |
| `src/orchestrator/llmActivity.ts` | LLM call (adapts to global/EU mode) |
| `src/orchestrator/toolDispatchActivity.ts` | Routes tool_calls to handlers |
| `src/orchestrator/sendReplyActivity.ts` | Proactive Teams replies |
| `src/orchestrator/tokenBudget.ts` | 80% threshold logic |
| `src/orchestrator/stateManager.ts` | Loads/persists session context from Cosmos |
| `src/orchestrator/executorActivity.ts` | Non-LLM executor for high-risk actions |
| `src/orchestrator/durableHookActivity.ts` | Registers/manages persistent hooks |

## Sub-Agent Isolation
Every tool call runs in a **fresh, isolated LLM session** (`subAgentActivity.ts`):
- No shared conversation history with the overseer
- Uses the secondary (faster) model by default
- Receives only the minimal context needed for that specific tool
- Cannot call other tools recursively
- This prevents prompt injection bleed between tool calls

## Durable Hooks (0h)
- Hooks survive `ContinueAsNew` — overseer carries their IDs forward in the summary
- Hook callbacks raise Durable external events back to the overseer
- Never poll for hook results — always event-driven

## Always
- ✅ All side-effects go through activity functions
- ✅ Guard user-visible side-effects with stable idempotency claims before emission
- ✅ Check token budget before each new message — ContinueAsNew if ≥ 80%
- ✅ Drain all pending external events before ContinueAsNew
- ✅ Carry summary + active hook IDs through every ContinueAsNew call
- ✅ Use isolated sub-agent sessions for every tool dispatch

## Never
- ❌ Do NOT Call the LLM, write to Cosmos, or send a Teams message from orchestrator code directly
- ❌ Do NOT Assume planner-level dedup is enough for external side-effects — protect the emitting activity/handler too
- ❌ Do NOT Use `await` on non-Durable-aware async functions inside orchestrators
- ❌ Do NOT Share conversation history between the overseer and a sub-agent session
- ❌ Do NOT Allow recursive tool calls (sub-agents cannot call tools)
- ❌ Do NOT Block on user confirmation — raise the card, then `yield` an external event

*We are the bridge.*
