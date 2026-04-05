# Open Workstreams Snapshot — SitRep 2026-04-02

## Purpose

This appendix is a compact snapshot of the major open workstreams and the most relevant recent closure wave that contextualize the current SitRep.

It is not a replacement for the full GitHub backlog. It is a practical owner-facing map of the areas most likely to matter for reprioritization right now.

## A. Open recurring / epic / sub-epic workstreams

### Recurring alignment rails

- `#3` — `[RECURRING] Codebase Health & Documentation Alignment`
- `#5` — `[RECURRING] Architecture & Design Introspection Pass`
- `#202` — `[RECURRING] Living Documentation Sync`
- `#372` — `[RECURRING] DevLoop Delivery → Docs Sync`

### Core architecture / platform epics

- `#68` — `[EPIC] Hydra-Net Multimodal Embeddings`
- `#71` — `[EPIC] Durable Hooks & Long-Running Workflows`
- `#75` — `[EPIC] SkillForge Ephemeral Skill Creator`
- `#88` — `[EPIC] Abstract Ethos & Special Circumstances Integration`
- `#90` — `[EPIC] DevLoop Bidirectional Relay`
- `#94` — `[EPIC] Model-Specific Tool Presentation & Self-Tuning Loop`
- `#101` — `[EPIC] Virtual Employees & Nested Orchestrators (Post-MVP)`
- `#194` — `[EPIC] Skills Library System – Manifest v2, Lifecycle, Onboarding & Tab UI`

### Newer strategic epics / sub-epics

- `#448` — `[EPIC] McpForge + MCP Registry integration for third-party skill discovery and controlled onboarding`
- `#455` — `[EPIC] Personal Skills Suite – Personal / Private Skill Track`
- `#462` — `[EPIC] Official Microsoft MCP control plane for virtual business/admin work`
- `#472` — `[SUB-EPIC] M365 operational admin slice: employee provisioning, mailbox lifecycle, and readiness`
- `#483` — `[SITREP] 2026-04-02 holistic drift assessment: skill readiness UX, orchestration continuity, and architecture-vs-runtime alignment`

## B. High-value open issues most relevant to current owner confidence

### Trust / honesty / runtime UX

- `#480` — model-provider error on Azure resource-group request
- `#483` — current SitRep
- `#484` — distinguish loaded/installed from operational state in Skills Library and readiness UX
- `#485` — follow-up skill verification drifting into health/discovery prose instead of execution proof

### Enterprise / M365 delivery

- `#243` — Entra ID Directory Lookup & Write
- `#462` — Microsoft MCP control-plane epic
- `#472` — M365 operational admin sub-epic
- `#473` — employee provisioning and initial license flow
- `#474` — mailbox lifecycle operations
- `#476` — post-provision readiness checks
- `#447` / `#443` — hybrid identity / bot-vs-user identity design inflection

### MCP platform evolution

- `#448` — McpForge epic
- `#481` — update metadata + low-cost update monitoring for MCP-integrated skills
- `#482` — orchestrator fallback into MCP Registry candidate search

## C. Recent closure wave that matters for this SitRep

The late-March / early-April closure wave strongly shaped the current product state:

### MCP / Enterprise integration wave

- `#449` — MCP Registry discovery ingest + search
- `#450` — first-party MCP-compatible connector
- `#451` — McpForge onboarding / manifest draft flow
- `#452` — safety and activation gates for third-party MCP onboarding
- `#465` — Microsoft Graph Enterprise MCP integration slice
- `#464` — Azure MCP integration slice
- `#466` — Microsoft Learn MCP integration slice
- `#477` / `#478` — McpForge validation hardening

### Continuity / orchestration / follow-up wave

- `#405` — clarification loop epic
- `#408` — first usable clarification loop
- `#428` — resumed clarification routing bug
- `#431` — quoted clarification reply ack-stranding bug
- `#329` — raw orchestration/sub-session leakage into end-user chat

### Skills / rollout standards wave

- `#371` — rollout standards for config-gated skills
- `#376` — Skills Library management UX gap
- `#304` — product-grade Teams tab UX correction

## D. SitRep interpretation of the snapshot

The repo is currently strong in **architectural breadth and backlog richness**, but the highest-risk drift is not missing ambition — it is **truthfulness and continuity at the product edge**.

In practical terms:
- many capabilities now exist in some real form
- many issue slices were legitimately delivered
- but user-facing honesty about readiness, operability, and continuity has not kept up evenly across the system

That is why the current recommendation is to bias near-term effort toward a stability-and-honesty correction pass before pushing significantly more visible capability surface area.