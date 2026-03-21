# HelkinSwarm ADDENDA — Master Index

> Implementation-ready specification addenda that fill gaps between the high-level v2 architecture docs and actual code requirements.

---

## Series Overview

The ADDENDA series provides **implementation-ready specifications** for features described conceptually in the main doc set (01–16, 0a–0r). Each ADDENDA document covers a focused subsystem with:

- **Exact data structures** (TypeScript interfaces, Zod schemas)
- **File-level implementation plans** (which file to create/modify)
- **Acceptance criteria** (verifiable checklist)
- **Cross-references** to relevant docs

---

## Document Index

| Doc | Title | Status | Key Implementation |
|-----|-------|--------|-------------------|
| [ADDENDA-01](ADDENDA-01-Turn-Telemetry-and-Correlation-ID-System.md) | Turn Telemetry & Correlation ID System | Spec complete | `cc-XXXXXXXX` format, 8-component health probe, App Insights schema |
| [ADDENDA-02](ADDENDA-02-Sub-Agent-Executor-Pattern-and-Privilege-Separation.md) | Sub-Agent / Executor Pattern & Privilege Separation | Spec complete | Read-only sub-agent, dumb executor, session hash anti-tamper |
| [ADDENDA-03](ADDENDA-03-Tab-Infrastructure-Control-Center-and-Dev-Console.md) | Tab Infrastructure — Control Center & Dev Console | Spec complete | Global SPA + per-stamp backends, session tracer |
| [ADDENDA-04](ADDENDA-04-Capability-Hot-Reload-Tool-Registry-and-Confirmation-Cards.md) | Capability Hot-Reload, Tool Registry & Confirmation Cards | Spec complete | Zod-validated manifest, OpenAI-format registry, 5-step verification cards |
| [ADDENDA-05](ADDENDA-05-Auth-Identity-Layer-OBO-Token-Minting-and-Emergency-Stop.md) | Auth Identity Layer — OBO, Emergency Stop & Maintenance | Spec complete | UAMI → OBO → scoped tokens, Cosmos-backed e-stop, 4 maintenance states |
| [ADDENDA-06](ADDENDA-06-Token-Budget-Tool-Budget-Scaler-Input-Canonicalization.md) | Token Budget, Tool Budget Scaler & Input Canonicalization | Spec complete | Correct `_latestPromptTokens` metric, 5 heuristic scaler, 5 canonicalization rules |

---

## Cross-Reference Map

```
ADDENDA-01 (Telemetry)
  └─ Referenced by: ADDENDA-03 (Tab Infrastructure), ADDENDA-04 (Dev Console traces)

ADDENDA-02 (Executor Pattern)
  └─ Referenced by: ADDENDA-04 (tool registry filtering), ADDENDA-05 (privilege scopes)

ADDENDA-03 (Tabs)
  └─ Depends on: ADDENDA-01 (health probe endpoint), ADDENDA-04 (capability count endpoint)

ADDENDA-04 (Capability + Confirmation)
  └─ Depends on: ADDENDA-02 (privilege separation)
  └─ Referenced by: ADDENDA-03 (reload endpoint), ADDENDA-05 (emergency stop)

ADDENDA-05 (Auth + E-Stop)
  └─ Depends on: Cosmos DB schema (ADDENDA-NOTE: Cosmos schema deferred to ADDENDA-07)
  └─ Referenced by: ADDENDA-04 (confirmation card privileged actions)

ADDENDA-06 (Token Budget + Canonicalization)
  └─ Standalone — no cross-addenda dependencies
  └─ Referenced by: Overseer orchestrator (doc 08)
```

---

## Pending Addenda (Not Yet Written)

| Priority | Title | Blocks |
|----------|-------|--------|
| HIGH | ADDENDA-07: Cosmos DB Schema — Complete 8-container definition with indexing policies | ADDENDA-05 |
| HIGH | ADDENDA-08: Durable Hooks — External event wiring, retry policies, dedup | Doc 0h |
| MEDIUM | ADDENDA-09: DevLoop Relay Protocol — Structured JSON, session resurrection, watchdog | Doc 0g |
| MEDIUM | ADDENDA-10: Memory Manager — saveSessionSummary, recallMemory, EU events | Doc 0i, 0e |
| LOW | ADDENDA-11: Bot Framework Adapter — MSI auth chain, conversation store | Doc 10, 11 |

---

## How to Use This Series

1. **Pick a gap** from the v2 codebase audit or issue triage
2. **Find the relevant ADDENDA** (or identify it needs to be created)
3. **Implement from the spec** — the file list + acceptance criteria give you a complete checklist
4. **Mark verified** against the acceptance criteria before closing the issue

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | March 2026 | Initial 6-document ADDENDA series |
