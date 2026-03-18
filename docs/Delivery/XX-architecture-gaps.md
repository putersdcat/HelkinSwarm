# HelkinSwarm Alpha — Architecture Gaps & Reopen Notes
**Harvested:** 2026-03-18 (Nuclear Reset Phase 0)  
**Purpose:** Preserve gap intelligence from old alpha repo before nuclear purge. These are items that were open/flagged as needing remediation in the alpha codebase. Carry forward into new issue backlog as appropriate.

---

## Gaps (label: needs-reopen-gap)

### #62 — [EPIC] Durable Hooks & Long-Running Workflows
**Spec ref:** `0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md`  
**Status:** Alpha had a partial/stubbed implementation. Durable hooks for external triggers were wired but not fully tested. The gap is the webhook listener and scheduler polling not fully wired to real durable orchestrator patterns.  
**Carry forward:** Must be a core Phase 3-4 deliverable in v2. See spec 0h.

### #66 — [EPIC] SkillForge Ephemeral Skill Creator
**Spec ref:** `0f-SkillForge-Ephemeral-Skill-Creator.md`  
**Status:** Container architecture, sandbox, GitHub App auth all started but incomplete. SkillForge sandbox boundaries not enforced. Alpha implementation was stub-only.  
**Carry forward:** Phase 4 deliverable. Sub-issues: #67 (container), #68 (GitHub App auth), #69 (sandbox safety).

### #67 — SkillForge container architecture & base image
**Spec ref:** `0f-SkillForge-Ephemeral-Skill-Creator.md`  
**Status:** Container base image and architecture not built in alpha.  
**Carry forward:** Required for SkillForge in v2 Phase 4.

### #68 — SkillForge GitHub App auth for PR creation
**Spec ref:** `0f-SkillForge-Ephemeral-Skill-Creator.md`  
**Status:** Not implemented. SkillForge needs to create PRs back to the repo via a GitHub App (not PAT).  
**Carry forward:** Phase 4. Security requirement — never use PAT for SkillForge automation.

### #69 — SkillForge sandbox, security boundaries & prompt
**Spec ref:** `0f-SkillForge-Ephemeral-Skill-Creator.md` + `04-Safety-Architecture.md`  
**Status:** Sandbox not implemented. LLM prompt for skill generation not hardened.  
**Carry forward:** Phase 4. High safety priority — must route through verification pipeline.

### #109 — [EPIC] Bidirectional Communication Expansion & Resurrection
**Spec ref:** `0p-Bidirectional-Communication-Expansion.md`, `0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md`  
**Status:** Alpha had partial DevLoop relay. The VS Code extension (copilot-resurrect, `#122`) was not built.  
**Carry forward:** Phase 5+ (post-MVP). The DevLoop runtime relay is a Phase 2 dependency.

### #122 — VS Code Copilot Resurrection extension
**Spec ref:** `0p-Bidirectional-Communication-Expansion.md` Section 3.1  
**External repo:** `https://github.com/putersdcat/copilot-resurrect.git`  
**Status:** Extension not built. Issue tracks fork + implementation of bidirectional OOM-resilient IDE relay.  
**Carry forward:** Post-MVP. Referenced from EPIC #109.

### #163 — Queue offline chat requests & startup recovery
**Spec ref:** `0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md` (related)  
**Status:** Not implemented in alpha. Standalone feature request with detailed spec in issue body.  
**Carry forward:** Phase 4 or post-MVP. See full feature doc in `XX-features.md`.

### #177 — SkillForge output must route through verification pipeline
**Spec ref:** `04-Safety-Architecture.md` + `0e-Safety-and-Four-Eyes-Verification-Pipeline.md`  
**Status:** Not wired in alpha. SkillForge output (generated skill code) was NOT routed through the safety pipeline.  
**Carry forward:** Phase 4 with SkillForge. Critical safety requirement — non-negotiable.

---

## Summary of Core Gaps to Address in v2

| Priority | Gap | Phase |
|----------|-----|-------|
| P0 | SkillForge → verification pipeline wiring (#177) | Phase 4 |
| P0 | SkillForge container + sandbox + GitHub App auth (#66/#67/#68/#69) | Phase 4 |
| P1 | Durable hooks fully wired to real triggers (#62) | Phase 3 |
| P1 | Bidirectional DevLoop relay foundation (#109) | Phase 2 |
| P2 | Offline chat queue + startup recovery (#163) | Phase 4+ |
| P3 | copilot-resurrect VS Code extension (#122) | Post-MVP |
