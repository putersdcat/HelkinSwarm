---
applyTo: "src/orchestrator/**"
---

# Orchestrator Patterns Rules
**Spec ref:** `docs/08-Orchestrator-Patterns.md`, `docs/0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md`, `docs/0t-Idempotency-and-External-Side-Effects.md`
**Infrastructure ref:** `.github/instructions/durable-functions-infra.instructions.md` (Azure Storage backend pitfalls, extended sessions, out-of-order messages, drain loop problem)

## Critical Rule
The orchestrator must remain **completely deterministic**. Every side-effect — LLM calls, tool execution, reply sending, hook registration — must be an **activity function**. No I/O of any kind in orchestrator code.

## Overseer (`src/orchestrator/overseer.ts`)
- **One instance per message** — NOT an eternal loop. Each overseer processes exactly one turn, then completes (#598, #280)
- ContinueAsNew was removed: Azure Storage backend does NOT truncate history, causing unbounded growth and progressively slower replays
- The old `while(true)` drain loop was replaced with a **handoff-to-fresh-overseer** pattern
- After processing, checks for buffered followers → if found, starts a fresh overseer instance via `handoffToFreshOverseerActivity`
- If no followers, enters an **ingress window** (60s DEDUP_HOLD) waiting for `NewMessage`, `HookFired`, or `BufferedIngressQueued` events
- State persists via Cosmos DB (loadState/saveState), not via Durable history carry-forward
- External events: `NewMessage`, `BufferedIngressQueued`, `HookFired`, `ConfirmationResponse`

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
| `src/orchestrator/overseer.ts` | Single-turn orchestration + ingress window + handoff |
| `src/orchestrator/sessionOrchestrator.ts` | One-turn sub-orchestration (prompt → LLM → tools → reply) |
| `src/orchestrator/handoffToFreshOverseerActivity.ts` | Starts fresh overseer for buffered followers (#598) |
| `src/orchestrator/postReplyBatchActivity.ts` | Batches storeMemory + saveState + saveChronoContinuity |
| `src/orchestrator/buildPromptActivity.ts` | Prompt assembly with skill memory + Hydra-Net |
| `src/orchestrator/llmActivity.ts` | LLM call (adapts to global/EU mode) |
| `src/orchestrator/toolDispatchActivity.ts` | Routes tool_calls to handlers |
| `src/orchestrator/sendReplyActivity.ts` | Proactive Teams replies |
| `src/orchestrator/stateManager.ts` | Loads/persists session context from Cosmos |
| `src/orchestrator/executorActivity.ts` | Non-LLM executor for high-risk actions |
| `src/orchestrator/mindSessionGuard.ts` | Durable entity: one active overseer per user |
| `src/orchestrator/spinnerHeartbeatActivity.ts` | UX spinner messages during processing |
| `src/orchestrator/replyDeliveryRecoveryActivity.ts` | Detects stuck sessions where reply was sent but sub-orchestrator hung |
| `src/functions/index.ts` | **ALL activity/orchestration imports** — missing import = silent hang |
| `host.json` | Durable task config (polling interval, extended sessions) |

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
- ✅ Import every new activity/orchestration in `src/functions/index.ts` (missing = silent hang forever)
- ✅ Release MindSessionGuard on EVERY exit path (normal, timeout, error, handoff)
- ✅ Use Durable timers (`context.df.createTimer`) not JS `setTimeout`
- ✅ Minimize sequential yields — batch parallel work into single activities (e.g. `postReplyBatchActivity`)
- ✅ Use deterministic per-turn instanceIds for sub-orchestrators (`session-${instanceId}-${correlationId}`)
- ✅ Pre-purge stale sub-orchestrator instances before `callSubOrchestrator`
- ✅ Use `handoffToFreshOverseerActivity` for followers — never loop in the same overseer instance
- ✅ Use isolated sub-agent sessions for every tool dispatch

## Never
- ❌ Do NOT Call the LLM, write to Cosmos, or send a Teams message from orchestrator code directly
- ❌ Do NOT Use `while(true)` drain loops in the overseer — causes unbounded history growth (#598)
- ❌ Do NOT Use `setTimeout` / `setInterval` in orchestrators — JS timers unreliable in Container Apps
- ❌ Do NOT Use a static sub-orchestrator instanceId across multiple turns (stale state attachment)
- ❌ Do NOT Add durableTask settings to host.json without reading `durable-functions-infra.instructions.md`
- ❌ Do NOT Create an activity file without importing it in `src/functions/index.ts` (silent hang, #327)
- ❌ Do NOT Assume planner-level dedup is enough for external side-effects — protect the emitting activity too
- ❌ Do NOT Share conversation history between the overseer and a sub-agent session
- ❌ Do NOT Allow recursive tool calls (sub-agents cannot call tools)
- ❌ Do NOT Block on user confirmation — raise the card, then `yield` an external event

*We are the bridge.*
