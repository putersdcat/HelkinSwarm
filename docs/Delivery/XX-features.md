# HelkinSwarm Alpha — Features Harvest
**Harvested:** 2026-03-18 (Nuclear Reset Phase 0)  
**Purpose:** Preserve feature intelligence from old alpha repo before nuclear purge. Features not strictly originating from the existing docs/*.md spec, or features with notable implementation progress that needs to transfer forward.

---

## Feature: Offline Chat Queue + Startup Recovery
**Alpha Issue:** #163  
**Spec origin:** Standalone — not explicitly in original docs  
**Status:** Designed, not implemented  

### Summary
When the backend (Functions/Orchestrator) is offline/restarting, users may send messages that get dropped. Feature implements:

1. **Ingress capture during downtime** — Durable ingress queue (Azure Service Bus or Cosmos DB `pending_intents` container with TTL and idempotency keys). Bot adapter persists turns as pending_intent with fields: `idempotency_key`, `timestamp`, `user/tenant`, `channel_message_id`, `text/attachments`, `classified_intent`, `requires_confirmation`, `external_effects`, `risk_level`. Graceful "We're restarting; I'll handle this when I'm back online" reply with tracking ID.

2. **Startup recovery job** — On app startup, run recovery orchestrator scanning `pending_intents` (status: received/failed), ordered by timestamp:
   - Simple + non-destructive → auto-execute
   - External effects + covered by pre-approval policy → auto-execute  
   - Otherwise → proactive confirmation card to user before executing

3. **Offline Recovery Policy** — Per-user/tenant pre-approval policy for which action types can auto-run from backlog (e.g., "Create GitHub issue", "Add comment", "Store memory", "Draft (no-send)"). Includes: audit trail, scopes, expirations, safety floor (never allow destructive ops). Idempotency key dedup prevents duplicate external actions.

4. **Safety alignment** — Production safety mode is confirmation-gated. External modifications require explicit approval unless covered by durable pre-approval policy.

5. **Telemetry** — Backlog size at startup, processed count by outcome (auto/prompted/skipped), p50/p90 latency. App Insights dashboards + alerts.

**Implementation notes:**
- Consider Azure Service Bus for durability/back-pressure
- Cosmos DB `pending_intents` container with TTL for cleanup
- Short-circuit: requires proactive messaging permissions + stored conversation references

---

## Feature: Skills Library Expansion (Outlook, Calendar, Files, Azure)
**Alpha Issue:** #186  
**Spec origin:** `05-Capabilities-Framework.md` + `0d-Enhanced-Safety-Segregation-Delegated-Identity-and-SkillForge.md`  
**Status:** Partial — skill handler stubs created in alpha  

### Summary
New skill handlers were being built in the alpha codebase:
- `src/tools/handlers/calendar.ts` — Calendar skill handler  
- `src/tools/handlers/outlook.ts` — Outlook skill handler  
- `src/tools/handlers/onedrive.ts` — OneDrive/Files skill handler  

Corresponding skill packages were created under `skills/calendar/`, `skills/onedrive/`, `skills/outlook/`.  
These were in-progress stubs — not yet wired to real Graph API calls or the tool registry.

**Carry forward:** Phase 3–4. Wire through Graph scoped token pattern with OBO flow. Must pass through verification pipeline.

---

## Feature: Multi-Instance Stamping + Global Router
**Alpha Issue:** #184 (parent), derived from `0q-Multi-Instance-Architecture.md`  
**Spec origin:** `0q-Multi-Instance-Architecture.md` (new spec added just before reset)  
**Status:** Not started  

### Summary
- Each user gets their own stamped Azure resource group: `rg-HelkinSwarm-{alias}`  
- All resources suffixed with user alias  
- Central `HelkinSwarm-router` Azure Function: receives Teams activity → extracts UPN → lookups alias in `config/user-map.json` → redirects to user-specific Functions URI  
- Teams app manifest points once to the router, not to individual user instances  
- First user: `eric@putersdcat.com` → alias `a7f2`  

**Implementation details:**
- `config/user-map.json` format:
  ```json
  {
    "eric@putersdcat.com": {
      "guid": "123e4567-e89b-12d3-a456-426614174000",
      "alias": "a7f2",
      "rg": "rg-HelkinSwarm-a7f2",
      "status": "active"
    }
  }
  ```
- All workflows accept `USER_ALIAS` parameter; all resources suffixed `-{{userAlias}}`  
- Router needs Microsoft Docs MCP research for best practices (cost-efficient, low-latency redirect)  

**Carry forward:** Phase 5 of Bootstrap Playbook.

---

## Feature: DevLoop Self-Improvement / DevQuery Protocol
**Alpha Issue:** #162 (runtime model upgrade), #109 (bidirectional relay)  
**Spec origin:** `0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md`, `0b`, `0m`  
**Status:** Partial relay implemented in alpha; not fully hardened  

### Summary
- DevLoop uses bidirectional MCP side-channel to send DEVQUERY messages to IDE  
- TIK-TOK cycle: model interrogates itself, flags gaps, feeds back to backlog  
- Runtime model upgrade to `gpt-5.4` + benchmarking to generate optimized tooling/skills mask  
- copilot-resurrect VS Code extension for OOM resilience (see #122)  

**Carry forward:** Phase 2 (relay foundation) + Phase 5 (full self-tuning eval loop).

---

## Feature: Turn-by-Turn Debug Telemetry
**Alpha Issue:** #107 (closed/validated in alpha)  
**Spec origin:** `0n-Turn-by-Turn-Debug-Telemetry.md`  
**Status:** Validated in alpha — carry forward specification to v2 from day one  

### Summary
Every orchestrator turn emits structured telemetry: correlation ID, model used, tool calls dispatched, latency buckets, risk tier, outcome. Dev Console tab in Teams shows live turn trace. Must be wired from the first bot turn in v2.

---

## Feature: Teams Tabs (Dev Console)
**Alpha Issue:** #108 (closed/validated), #191 (wiring)  
**Spec origin:** `0o-Microsoft-Teams-App-Expansion-with-Tabs.md`  
**Status:** Spec validated; wiring not completed in alpha  

### Summary
Teams app expands to include static and interactive tabs:
- Dev Console tab: live turn trace, model stats, active orchestrations  
- Memory browser tab  
- Skills/tools catalog tab  

Manifest changes needed: add `staticTabs` and `configurableTabs` entries pointing to tab endpoints.  
**Carry forward:** Phase 3–4 (after core runtime is live).
