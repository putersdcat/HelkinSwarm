# HelkinSwarm Project Specification

## 13. Observability & Monitoring (Refined)

### Overview

HelkinSwarm is built to be **fully observable** from day one. Every turn, tool call, safety check, durable hook event, skill-memory injection, and model invocation is traced with correlation IDs, structured logs, and rich telemetry so you can understand exactly what happened — even weeks later.

Observability is **not** an afterthought. It is a core architectural requirement that supports the entire digital body (0l): the brain (overseer) must always know what its limbs (skills), senses (Hydra-Net), and persistent memory (durable hooks + skill vaults) are doing.

### Core Observability Stack

| Layer                  | Technology                          | Purpose |
|------------------------|-------------------------------------|-------|
| **Structured Logging** | App Insights + custom events        | Per-turn traces with full context |
| **Correlation**        | Correlation ID (propagated everywhere) | End-to-end tracing across orchestrator, sub-agents, tools, durable hooks (0h), and DevLoop relay (0g) |
| **Health Endpoint**    | `/api/health`                       | 8-component live status (LLM, memory, safety, durable hooks, skill vaults, Hydra-Net) |
| **Diagnostics**        | `/api/sessions`, `/api/traces`, `/api/cost`, `/api/durable-hooks` | Real-time dashboards |
| **Alerting**           | Azure Monitor Scheduled Query Rules | P0 alerts for EU violations, emergency stop, rate limits, verification failures |
| **Dev Console Tab**    | Personal Teams tab (served from global SPA; data from stamp tab backend — see #107) | Owner-only deep inspection (sessions, traces, skill memory summary (0i), durable hook status (0h)) |

### Correlation ID Flow

Every incoming Teams message (and every DevLoop message) receives a unique `correlationId` at the Bot Framework layer. This ID is:
- Passed through the Overseer
- Attached to every LLM call, tool execution, sub-agent, verification step (0e), durable hook registration (0h), and skill-memory write (0i)
- Included in all App Insights events and Hydra-Net embedding operations (0k)
- Visible in the Dev Console tab and retrievable via the bidirectional relay (0g)

You can search App Insights for any correlation ID and see the complete end-to-end trace.

### Key Telemetry Events

- `TurnStarted` / `TurnCompleted`
- `PromptShieldResult` (attack detected or clean)
- `ToolExecuted` (with risk level, lane, duration, skillId)
- `ScopedTokenMinted`
- `VerificationPipelineResult` (0e)
- `HumanConfirmationRequested`
- `DurableHookRegistered` / `DurableHookTriggered` (0h)
- `SkillMemoryInjected` (0i)
- `HydraNetEmbedding` (0k)
- `ContinueAsNewTriggered`
- `EUResidencyViolation` (P0 alert)
- `DevLoopSteerReceived` (0g)

### Health Report (`/api/health`)

Returns a full JSON status:

```json
{
  "status": "healthy",
  "components": {
    "overseer": "running",
    "llm": { "primary": "grok-4-1-fast-reasoning", "latency": "87ms" },
    "memory": "connected",
    "safetyMode": "confirmation-gated",
    "euResidencyMode": false,
    "durableHooks": "12 active",
    "skillVaults": "7 loaded"
  },
  "correlationId": "..."
}
```

### Dev Console Tab (Owner Only) (served from global SPA; data from stamp tab backend — see #107)

A rich personal tab with:
- Live session list + kill buttons
- Recent traces with correlation search
- Model health cards + rate-limit headroom
- Cost breakdown
- Durable hook status (0h)
- Skill memory summary per skill (0i)
- DevLoop relay health (0g)
- Emergency stop controls

### Alerting (Sentinel + Azure Monitor)

Critical P0 rules (auto-created in Bicep):
- Any EU residency violation
- Emergency stop triggered
- Rate-limit exhaustion on frontier models
- Verification pipeline failure on high-risk action
- Durable hook timeout or repeated failures (0h)

### What NOT to Do

- ❌ Never log raw user messages or PII in App Insights
- ❌ Never disable correlation IDs
- ❌ Never add custom logging that bypasses the structured event system
- ❌ Never expose the Dev Console tab to non-owner users
- ❌ Never treat observability as optional — it is part of the safety architecture (0e)

### Furious Development Phase Exception (`#579`)

The current personal dev phase operates under an explicit cost emergency exception:

- stamp-level **paid observability is intentionally disabled by default** via `earlyDevCostGuard`
- router-level **paid observability is intentionally disabled by default** via the same source-controlled guard extension (`#580`)
- the global tab host remains a storage-only surface and now carries its own RG budget/assertion layer so hidden monitor resources cannot quietly appear there (`#580`)
- the current Azure-safe implementation of that posture is `azure-monitor` with no diagnostic settings on the Container Apps environment, so live log streaming remains available without workspace persistence
- this does **not** mean observability is architecturally unimportant; it means retained Azure Monitor telemetry is temporarily too expensive for the current development burn rate
- live log streaming, health checks, workflow assertions, and targeted investigations remain available, but persistent LAW/App Insights history on the main dev stamp is intentionally suppressed until the owner authorizes re-enablement

This exception exists because April 2026 proved that workspace-backed observability could silently regress to >$1/day during early development without improving product functionality.

> ⛔ Do not remove the early-dev observability exception, the stamp/router/tab-host resource-group budgets, or the workflow post-deploy assertions until the owner/human-in-the-loop explicitly authorizes the end of the furious development phase.
