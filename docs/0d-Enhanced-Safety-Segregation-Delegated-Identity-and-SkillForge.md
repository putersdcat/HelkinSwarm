# HelkinSwarm Project Specification

## 0d. Enhanced Agent Safety, Segregation, Delegated Identity & SkillForge

**Feature Specification**  
**Version:** 1.0 (Unchained Edition)  
**Date:** March 2026  
**Status:** Draft – Ready for implementation

### 1. High-Level Goals

This layer defines the production-grade safety, least-privilege execution, user-delegated identity passthrough, and SkillForge capability for HelkinSwarm.

- Least-privilege at every layer, zero trust between components.  
- Data minimization on every boundary.  
- Mandatory four-eyes verification on all sub-agent responses (detailed in **0e**).  
- Human-in-the-loop gating for high-risk actions.  
- User-delegated identity passthrough for personal-scope tools.  
- SkillForge: secure, ephemeral skill-creation container spun up on demand.  
- Staged rollout: read-only → confirmation-gated → full-destructive.  
- Full compatibility with global frontier models (default) and EU DataZoneStandard (toggle).

### 2. Core Components & Runtime Model

- **Orchestrator**: Long-lived Durable Function using the primary model (global frontier by default). Handles persistent memory, token rollovers, and natural-language routing.  
- **Sub-Agents**: Spawned as separate Durable Activity Functions with fresh LLM sessions.  
- **Executor Agents**: Non-LLM, code-only Durable Activities for destructive actions (receive only vetted IDs).  
- **SkillForge**: Ephemeral Docker container (Azure Container Instances or Functions-managed) for dynamic skill prototyping. Destroyed after use.

### 3. Identity & Permissions Model

- **Base Orchestrator Identity**: User-Assigned Managed Identity with minimal read-only access at startup. No standing write/delete permissions.  
- **Per-Operation Tokens**: Short-lived (5-minute, auto-renewable for long operations) scoped tokens minted exactly for the tool’s privilege level (read-only / read-write / create / delete-only).  
- **User-Delegated Tokens** (for personal-scope tools): Onboarding flow triggers Entra consent. Refresh token stored encrypted in Key Vault (auto-renew on use). Short-lived access tokens issued per tool call.  
- **No PIM**: Escalation happens exclusively via user-consent flows.

### 4. Unified Tool Capability Framework

Runtime-loaded JSON capability map (auto-discovered from the modular `skills/` folder — see **0a**).

```json
{
  "domain": "outlook",
  "tool": "searchMessages",
  "privilege": "read-only",
  "risk": "low",
  "inputSchema": { "query": "string" },
  "outputSchema": { "messageIds": "array<string>" },
  "dataMinimize": true,
  "verification": "spotCheck",
  "spotCheckRule": "allIfUnder10, else random5"
}
```

Privilege levels map to Graph/GitHub/Azure scopes. Risk tiers drive confirmation and verification.

### 5. Delegated User Identity & Onboarding Flow

For tools that must act as the user (personal Outlook, OneDrive, GitHub, etc.):

**Onboarding Flow** (triggered once per integration):
1. User runs `/link <domain>` in Teams.
2. Orchestrator spawns bootstrap sub-agent → redirects to Entra consent screen.
3. User consents → refresh token stored encrypted in Key Vault.
4. Subsequent requests exchange for short-lived, scoped access tokens.

**Runtime Usage**:
- Sub-agent prompt always includes: “You are acting as the user. Query only data visible to this user.”
- High-risk delegated actions still trigger human confirmation + spot-check (see **0e**).
- Revocation: user removes consent in Entra → tokens invalidate instantly.

### 6. Safety & Four-Eyes Verification Pipeline

The complete mandatory pipeline that sits between every sub-agent (or SkillForge) response and the orchestrator’s decision-making is defined in detail in **0e-Safety-and-Four-Eyes-Verification-Pipeline.md**.

It enforces:
- Schema validation
- Data minimization
- Spot-check verification
- Prompt Shields
- Risk-tiered human confirmation

All steps are non-negotiable and applied universally.

### 7. SkillForge – Ephemeral Skill Creator

When no matching tool exists:

1. Routes request to SkillForge (heavy model, clean session).  
2. Spins up ephemeral Docker container from pre-baked base image.  
3. Uses GitHub App auth (private key from Key Vault) to clone, build, test, and open PR.  
4. On success: opens PR with full skill (manifest + code).  
5. After merge: orchestrator hot-reloads the new skill.

SkillForge is fully sandboxed, outbound-only, and destroyed after use. Its output is treated as a high-risk response and runs through the full pipeline in **0e**.

### 8. Development Staging & Runtime Configuration

Flags (App Settings / Key Vault):
- `SAFETY_MODE`: read-only | confirmation-gated | full-destructive  
- `CONFIRMATION_THRESHOLD`: 10  
- `SKILLFORGE_ENABLED`: true/false  
- `PROMPT_SHIELDS_ENABLED`: true/false  
- `EU_RESIDENCY_MODE`: false (global default) | true

Early development uses read-only + full audit logging.

### 9. Logging & Observability

Every token mint, sub-agent spawn, verification result (see **0e**), SkillForge job, and user confirmation is logged to App Insights with full correlation ID. Anomalies trigger alerts and auto-pause where appropriate.

### 10. Plugin Extension Pattern

Drop a new capability JSON + implementation into the modular `skills/` folder (see **0a**). SkillForge can prototype the rest.

This spec delivers enterprise-grade safety and delegated identity while preserving maximum performance and modularity. All components are composable and ready for immediate implementation.

