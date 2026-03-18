---
applyTo: "src/bot/**"
---

# Bot Framework Rules
**Spec ref:** `docs/10-Teams-Interface.md`

## Critical Rule
The bot handler is a **thin routing layer only**. It acks immediately, raises a Durable external event, and returns. All reasoning, safety, and tool execution happen in the overseer — never in the bot handler.

## Core Components

| File | Responsibility |
|------|----------------|
| `src/bot/adapter.ts` | Bot Framework Adapter — MSI auth factory |
| `src/bot/HelkinSwarmBot.ts` | Activity handler — routing, maintenance mode, ack management |
| `src/bot/humanConfirmation.ts` | Adaptive Card gates for destructive actions (0e) |
| `src/bot/conversationStore.ts` | Stores references for proactive replies and durable hook updates |
| `src/bot/maintenanceMode.ts` | Emergency stop + graceful offline replies |

## Message Flow (Every Turn)
1. Message arrives → `HelkinSwarmBot.ts` receives activity
2. **Immediately** send ack: `"⌛ Working on it..."` (store reference for in-place update)
3. Raise `NewMessage` external event to the eternal overseer
4. Handler returns — orchestrator does all the work
5. Final reply sent proactively via `sendReplyActivity.ts`; ack replaced in-place

## Slash Commands (Handled Before Overseer)

| Command | Access | Action |
|---------|--------|--------|
| `/emergency-stop` | Owner | Immediate global shutdown |
| `/emergency-resume` | Owner | Restore service |
| `/forge <idea>` | Owner | Route directly to SkillForge |
| `/heavy <prompt>` | Owner | Force global frontier model |
| `/light <prompt>` | Owner | Force fast global model |

## Adaptive Cards (Human Confirmation — 0e)
- All medium/high-risk actions require an Adaptive Card before execution
- Card contains: impact description, risk level badge, Approve/Cancel buttons, 5-minute auto-timeout
- Button click raises a Durable external event (`ConfirmationResponse`) back to the overseer
- Never block the handler waiting for a confirmation — it must be async

## Always
- ✅ Send the ack before doing anything else
- ✅ Use `conversationStore.ts` to persist conversation references for proactive replies
- ✅ Handle `/emergency-stop` and all slash commands before routing to overseer
- ✅ Use `src/bot/adapter.ts` MSI auth — never manual credential construction
- ✅ For bot-response debugging, use the Teams Test Harness MCP (`teams_test_full_probe`)

## Never
- ❌ Call the LLM or execute tools from within the bot handler
- ❌ Block the handler waiting for LLM response or tool results
- ❌ Use Playwright to send test messages to Teams
- ❌ Store secrets or tokens in conversation state
- ❌ Skip the ack on any non-trivial message

*We are the bridge.*
