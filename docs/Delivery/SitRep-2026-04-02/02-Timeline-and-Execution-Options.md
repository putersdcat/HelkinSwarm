# Timeline and Execution Options — SitRep 2026-04-02

## 1. High-level journey so far

### Foundational plan

File: `docs/Delivery/00-Development-&-Delivery-Master-Plan.md`

The master plan describes a broad journey:
- foundational runtime
- Teams interface
- eternal overseer
- tool dispatch and safety
- modular skills
- memory + SkillForge
- DevLoop/self-improvement

That plan assumes a progression from infrastructure and architecture seams into increasingly rich behavior.

### Recent late-March / early-April delivery pattern

The recent backlog history shows a strong burst of delivery in these areas:
- clarification-loop and follow-up handling
- quoted-reply support
- Skills Library / Teams tab surfaces
- MCP Registry + McpForge
- Microsoft/Azure MCP integrations
- Outlook/tool-surface/live-validation bugs

This is a classic zone where **surface richness can outrun product-state honesty** if status/validation models are not tightened in parallel.

## 2. Relevant recent delivery timeline

### Documentation / standards layer

- `#371` — rollout standards for config-gated skills
- `docs/05-Capabilities-Framework.md` now explicitly warns against exposing not-yet-configured skills as ready

### Teams / skill-surface layer

- `#304` — product-grade Teams tab UX correction
- `#376` — Skills Library management gap

### Quoted / continuity layer

- `#278` — structured quoted-reply context threading
- `#405` — clarification-loop epic
- `#408` — first usable clarification loop
- `#428` — resumed clarification routing bug
- `#431` — quoted clarification reply bug
- `#329` — raw orchestration/sub-session leakage into end-user chat

### MCP / external skill expansion layer

- `#448`–`#452` — MCP Registry + McpForge core slices
- `#464` — Azure MCP integration
- `#465` — Microsoft Graph Enterprise MCP integration
- `#466` — Microsoft Learn MCP integration
- `#476` — post-provision readiness checks for M365 admin workflows
- `#481` / `#482` — recent MCP follow-on backlog from the earlier reconciliation pass

## 3. Current open epic / workstream picture

Open major workstreams visible in the backlog include:

- `#194` — Skills Library System
- `#448` — McpForge + MCP Registry integration
- `#462` — Official Microsoft MCP control plane
- `#472` — M365 operational admin sub-epic
- `#75` — SkillForge
- `#71` — Durable Hooks
- `#90` / `#94` — DevLoop and self-tuning
- `#455` and adjacent personal-skill suite items
- `#483` — this SitRep

## 4. Remaining open topic map (practical grouping)

### Group A — Trust, honesty, and runtime UX correctness

These are the issues most directly tied to current user confidence:
- `#483` — holistic SitRep / drift assessment
- `#484` — distinguish loaded/installed from truly operational skill state
- `#485` — follow-up skill verification drifting into health/discovery prose
- `#480` — model-provider error on Azure resource-group request
- continuity/follow-up quality gaps around quoted replies and context carryover

### Group B — M365 / enterprise admin capability expansion

- `#462` — official Microsoft MCP control plane epic
- `#472` — M365 operational admin sub-epic
- `#473` — employee provisioning
- `#474` — mailbox lifecycle operations
- `#476` — post-provision readiness checks
- `#243` — native Entra directory lookup/write

### Group C — MCP platform expansion and hygiene

- `#448` — McpForge epic
- `#481` — update-check/provenance metadata
- `#482` — orchestrator fallback into MCP registry discovery
- ongoing runtime validation of Azure / Microsoft MCP integrations

### Group D — Broader capability expansion

- personal/private skills suite (`#455` and siblings)
- attachment / file-asset orchestration (`#413`, `#414`, `#416`, etc.)
- research/translation/deep-research/document skills

## 5. Current strategic interpretation

The repo appears to be at a fork where two different priorities are competing:

### Path 1 — Continue capability expansion aggressively

Pros:
- fast surface-area growth
- keeps momentum on Microsoft/MCP/admin integrations
- useful for proving architecture breadth

Cons:
- increases the chance that end-user trust continues to erode if state honesty and continuity remain loose
- makes debugging harder because more skills appear available than are truly operational

### Path 2 — Stability and truthfulness consolidation pass first

Pros:
- directly improves reliability and user confidence
- reduces misleading UI/status semantics
- makes future skill expansion easier to trust
- aligns better with the project’s anti-optimism directive

Cons:
- slows visible new-feature count in the short term

## 6. Recommended priority order

### Recommendation A — Immediate next priority

Treat the next tranche as a **stability/truthfulness correction wave**:

1. operational-state model for skills
2. Skills Library/status API/UI correction
3. follow-up / quoted-reply / continuity tightening
4. end-user response-discipline improvements (hide orchestration-heavy intermediate framing)

### Recommendation B — Then resume controlled expansion

After the correction wave:
- continue Microsoft/M365 admin slices
- continue MCP platform enhancements
- only expose new skills broadly once their readiness state is honest and operationally validated

## 7. Practical execution options

### Option Alpha — Product honesty first

Focus for the next sprint:
- skill readiness state model
- operational badge system in Skills Library
- preflight/fallback enforcement for config-gated skills
- quoted/follow-up continuity fixes
- regression probes for user-facing output discipline

Best if the goal is: **make the current app feel coherent and trustworthy before expanding further**.

### Option Beta — Dual-track

Track 1:
- fix honesty/continuity issues

Track 2:
- continue enterprise/MCP integrations behind stricter rollout gates

Best if the goal is: **keep momentum while containing UX debt**.

### Option Gamma — Expansion first, patch later

This is the least recommended option based on current evidence.

Why:
- it compounds misleading readiness states
- it increases the odds of more “looks delivered, feels confusing” moments
- it conflicts with the repo’s anti-optimism posture

## 8. Current recommendation to the owner

The strongest evidence-backed recommendation from this pass is:

> Pause broad expansion just long enough to fix the app’s truth-telling and continuity surfaces.

The architecture is not empty. The issue is that some of the current product-state reporting and follow-up behavior no longer reflect the sophistication—and fragility—of the underlying system clearly enough.

That is fixable, but it should be treated as a first-class delivery goal, not background polish.
