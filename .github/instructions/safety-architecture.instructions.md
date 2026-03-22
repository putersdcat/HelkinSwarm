---
applyTo: "src/config/safetyConfig.ts,src/llm/promptShields.ts,src/bot/confirmationCards.ts,src/auth/scopedTokenMinter.ts,src/functions/emergencyStop.ts"
---

# Safety Architecture

> **Fundamental Constraint:** Safety is enforced by architecture, not by prompt. The five-step verification pipeline is mandatory for ALL tool executions. No bypass flags. No shortcuts. Destructive operations NEVER touch the LLM — they flow through non-LLM executor agents.

**Spec References:** [04-Safety-Architecture.md](../../docs/04-Safety-Architecture.md), [0e-Safety-and-Four-Eyes-Verification-Pipeline.md](../../docs/0e-Safety-and-Four-Eyes-Verification-Pipeline.md)

---

## Safety Modes

| Mode | Description | Default |
|------|-------------|---------|
| `read-only` | All write/destructive operations blocked | No |
| `confirmation-gated` | Writes allowed with user confirmation for medium+ risk | **YES** |
| `full-destructive` | All operations allowed with per-action confirmation for high risk | No |

Switch modes via slash commands (`/light`, `/heavy`) or API.

## Five-Step Verification Pipeline

Every tool execution passes through ALL five steps in order:

| Step | Name | Action |
|------|------|--------|
| 1 | **Schema Validation** | Validate input against Zod schemas from capability manifest |
| 2 | **Minimize** | Strip unnecessary data, redact sensitive fields |
| 3 | **Spot-Check** | Automated test of the action's scope and impact |
| 4 | **Prompt Shields** | Azure Content Safety check on the complete action context |
| 5 | **Human Confirm** | Adaptive Card confirmation for medium+ risk actions (based on safety mode) |

## Risk Levels

| Level | Auto-Execute (confirmation-gated) | Executor Type |
|-------|------------------------------------|---------------|
| `low` | ✅ Yes | Direct (LLM can execute) |
| `medium` | ❌ Requires confirmation | LLM with verification |
| `high` | ❌ Always requires confirmation | Non-LLM executor agent |

## Executor Agents (High Risk)

For `high` risk operations:

- A **non-LLM executor agent** handles the actual mutation
- The LLM reasons about WHAT to do; the executor does it
- The executor is a deterministic code path — no model involved
- This prevents prompt injection from executing destructive actions

## Scoped Tokens

- Every tool action gets a scoped token minted from the capability manifest
- Token lifetime: **5 minutes** maximum
- Scopes: only what the specific tool needs (least privilege)
- Scoped tokens are separate from the root UAMI

## Emergency Stop

`/emergency-stop` command:

1. Kills all active orchestrations for the user
2. Terminates all durable hooks
3. Kills all sub-agents
4. Switches to `read-only` mode
5. Sends confirmation to user

## Always

- ✅ Run ALL five verification pipeline steps for every tool execution
- ✅ Use non-LLM executor agents for high-risk operations
- ✅ Mint scoped 5-minute tokens for every tool action
- ✅ Default to `confirmation-gated` safety mode
- ✅ Implement emergency stop as an instant kill of all user operations
- ✅ Apply Azure Content Safety (Prompt Shields) before every LLM interaction

## Never

- ❌ Do NOT Create bypass flags for the safety pipeline — no `--force`, no skip parameters
- ❌ Do NOT Let LLMs execute high-risk / destructive operations directly
- ❌ Do NOT Use long-lived tokens (>5 minutes) for tool execution
- ❌ Do NOT Skip any step of the five-step pipeline
- ❌ Do NOT Default to `full-destructive` mode
- ❌ Do NOT Store safety mode in a cookie or local state — persist in user profile (Cosmos)

---

*Maintained under Never-Close issues #3 (Codebase Health) and #4 (Architecture Introspection). We are the bridge.*
