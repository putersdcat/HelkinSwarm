# HelkinSwarm Project Specification

## 0u. MCP Forge Lightweight Skill Integration and Automatic Update Mechanism

**Version:** 1.1  
**Status:** Partially delivered; backlog reconciled against live code on 2026-04-02  
**Owner:** Principal Developer  
**Date:** 2026-04-02

### 1. Purpose

This addendum captures the intended direction for **MCP Forge** while staying honest about current implementation state.

It serves two jobs:

1. record the MCP Registry + McpForge features that are already shipped, and
2. define the remaining follow-on work that still belongs in the backlog.

This document must not pretend that every idea below is already wired into the runtime. Where functionality is still aspirational, it is called out explicitly and linked to backlog work.

### 2. Shipped State Verified in the Codebase

The following behavior is already implemented and wired:

- **Registry discovery cache and search**
	- `src/mcp/mcpRegistryCatalog.ts`
	- `ensureFreshMcpRegistryCatalog()` syncs the official MCP Registry into a local in-process cache.
	- `searchMcpRegistryCatalog()` returns candidate metadata shaped for downstream review.
- **Explicit core-tool access to MCP Registry discovery**
	- `skills/core/handlers.ts`
	- `helkin_mcp_registry_search` exposes `help`, `search`, `status`, and `refresh` over the cached registry view.
- **Explicit core-tool access to McpForge draft/approval flow**
	- `skills/core/handlers.ts`
	- `helkin_mcp_forge` exposes `draft_candidate`, `approve_bundle`, and `inspect_bundle`.
- **Draft bundle generation for registry candidates**
	- `src/mcp/mcpForgeDraft.ts`
	- `buildMcpForgeDraftBundle()` drafts a manifest + review bundle from a discovered candidate.
- **Local approval and hot-reload**
	- `src/mcp/mcpForgeActivation.ts`
	- `approveMcpForgeBundleLocally()` smoke-tests the draft, writes a local manifest under `skills/custom/<domain>/manifest.json`, and reloads capabilities.
- **Activation-gate and lifecycle state model**
	- `src/mcp/mcpOnboardingGates.ts`
	- `assessMcpCandidateForOnboarding()` classifies candidates as `discovered`, `review-required`, `blocked`, or `enabled`.
- **Owner-facing Skills Library registry UI**
	- `src/functions/tabSkills.ts`
	- `tabs/app.js`
	- The Skills Library tab already exposes registry search, draft, and approve flows.

### 3. Current Operating Model

Today, MCP Registry and McpForge operate as an **explicit discovery/onboarding lane**, not as a silent background capability.

The shipped flow is:

1. An owner uses the Skills Library registry view or the explicit MCP core tools.
2. HelkinSwarm searches a cached local copy of the official MCP Registry.
3. A candidate is evaluated into a McpForge draft bundle.
4. The draft captures manifest assumptions, uncertainties, and review notes.
5. Local approval runs an MCP smoke test.
6. If the smoke test succeeds, a local manifest is written into `skills/custom/`.
7. Capabilities are reloaded so the new local MCP-backed skill becomes visible to the runtime.

This is already lighter-weight than full SkillForge, but it is still **gated, explicit, and auditable**.

### 4. What Is Not Yet Shipped

The following ideas are **not** currently implemented as verified in the codebase:

- **No dedicated orchestrator-side automatic fallback into MCP Registry search**
	- I do not see `searchMcpRegistryCatalog()` wired into the orchestrator routing path.
	- The verified call sites are the explicit core tool (`skills/core/handlers.ts`) and the owner tab backend (`src/functions/tabSkills.ts`).
	- That means MCP Registry discovery exists today as an explicit tool/UI surface, not as a first-class automatic second-hop fallback after local skill discovery misses.
- **No manifest schema support for MCP provenance/update metadata**
	- `src/capabilities/manifestSchema.ts` does **not** define fields such as:
		- `updateCheckEnabled`
		- `updateCheckFrequency`
		- `updateSource`
		- `updateSourceUrl`
		- `mcpRegistryId`
- **No low-cost automatic update checker is wired**
	- I do not see a periodic GitHub-release ping, registry-version monitor, or equivalent update watcher for installed MCP-integrated skills.
- **No owner-facing update status surface exists yet**
	- The shipped MCP surfaces live in the **Skills Library** tab today.
	- I do not see a Dev Console-specific MCP update/provenance view wired yet.

### 5. Intended Future Direction

This addendum still supports the following product direction, but these should be treated as **future backlog slices**, not as already-delivered behavior:

- **Secondary capability-source routing**
	- when local installed-skill discovery misses, the orchestrator may optionally search MCP Registry candidates as a separate second-hop discovery lane
	- installed skills and external candidates must remain clearly separated
- **Manifest provenance and update metadata**
	- installed MCP-integrated skills should be able to retain source identity and update-check settings
- **Low-cost update monitoring**
	- routine update checks should use cheap metadata probes rather than LLM sessions
- **Owner UI visibility of installed MCP provenance/update health**
	- Skills Library is the minimum viable first surface
	- Dev Console integration can follow later if it proves useful

### 6. Revised Manifest Extension Direction

If MCP-integrated update tracking is added, the manifest/runtime model should be extended conservatively with optional fields such as:

- `mcpRegistryId`
- `updateCheckEnabled`
- `updateCheckFrequency`
- `updateSource`
- `updateSourceUrl`

If last-check timestamps/results do not belong in version-controlled manifest files, they should live in a runtime state store rather than being faked into source manifests.

### 7. Backlog Linkage

#### Existing issues already covering shipped or in-flight MCP Forge work

- `#448` — MCP Forge + MCP Registry integration epic
- `#449` — MCP Registry discovery ingest + search skill
- `#450` — first-party MCP-compatible connector/runtime adapter
- `#451` — McpForge evaluation + manifest drafting pipeline
- `#452` — safety, moderation, and activation gates
- `#453` — treat registry candidates as concept/research inputs for native skills

#### New backlog slices opened from this reconciliation pass

- `#481` — manifest traceability/update-check metadata and low-cost update monitoring for MCP-integrated skills
- `#482` — orchestrator-side fallback from installed-skill discovery into MCP Registry candidate search

### 8. Acceptance Criteria for Full Completion of This Addendum

This addendum should only be considered fully realized when all of the following are true:

- HelkinSwarm can use the MCP Registry as a clearly separated secondary discovery source when installed skills are insufficient.
- Installed MCP-integrated skills retain provenance metadata without bypassing the manifest/safety model.
- Update checks run through a low-cost read-only path with clear failure reporting.
- Owner-facing UI exposes installed MCP provenance/update state.
- None of this blurs external registry candidates with installed HelkinSwarm skills or bypasses McpForge review gates.

### 9. What Not to Do

- Do **not** describe explicit tool/UI surfaces as if they were already orchestrator-automatic.
- Do **not** pretend update metadata exists before it is added to `CapabilityManifestSchema` or equivalent runtime state.
- Do **not** auto-install registry candidates on discovery.
- Do **not** run heavy LLM reasoning for routine update pings.
- Do **not** blur installed skills, draft bundles, and external registry candidates into one status bucket.

---

This document extends `0a` and the MCP Forge backlog, but it now reflects the actual delivered state rather than a future-perfect one.
