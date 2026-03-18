**Here is the exact Markdown file** you can save and attach to a parallel GitHub Copilot Chat session.

**Filename suggestion:**  
`docs\RestartFromZero_Or_NotToBe_That_Is_The_Questions\REFORMATION-PLAN-2026-03-17.md`

```markdown
# HelkinSwarm v2.0 Reformation Plan  
**Decision: In-Place Remediation (Sharpen the Spear) — NOT full nuclear reset**  
**Date:** 2026-03-17  
**Folder:** `docs\RestartFromZero_Or_NotToBe_That_Is_The_Questions` (all prompts, diagnostics, and plans from today live here)

### 1. Executive Summary & Reasoning (why we are here)

- The original spec (Docs/01–16 + 0a–0l) defined a true layered digital-body architecture: Eternal Overseer → Session Sub-Orchestrator → isolated sub-agents → executor agents → four-eyes pipeline → just-in-time skill memory → durable hooks.
- Due to the poisoned AzureAgent persona (VS Code extension injection) + noisy comment chains, the Copilot LLM flattened the implementation into a generic chatbot with scaffolding.
- Diagnostic run (CODEBASE-FLOW-ANALYSIS.md, docs folder deliberately removed) confirmed: skeleton files exist, but 8 critical wiring layers are missing or stubbed.
- We have decided **against** a full nuclear reset (delete src/, purge everything, start from zero). Instead we will surgically clean and re-wire the existing codebase. This is faster, lower risk, and preserves all live in-chat features added after the bot went live.

### 2. Goals of This Reformation

- Compact all noisy comment chains across every issue.
- Tag cleanly so DevLoop can never see legacy noise again.
- Reopen only real gaps (IOUs, stubs, missing wiring).
- Produce a pristine backlog that the new DevLoop can trust.
- Fix the 8 critical architectural gaps identified in the diagnostic.

### 3. Exact Tasks to Execute (in order)

**Phase 1 – One-time Setup (run once)**
- Create GitHub labels: `re-validated-clean` and `needs-reopen-gap`.
- Update (or create) `.github/instructions/devloop-harness.instructions.md` with the permanent exclusion rule for `legacy-v1` and `re-validated-clean`.

**Phase 2 – Issue Remediation (single master prompt already provided)**
- Re-process EVERY issue (open + closed).
- Read only body + first 5 comments.
- Cross-reference Docs/ and the diagnostic gaps.
- Tag `re-validated-clean` or reopen with `needs-reopen-gap` + compact comments.
- Produce summary table after every 20 issues.

**Phase 3 – Targeted Gap Fixes (DevLoop will handle after remediation)**
The reopened issues will focus on these 8 critical gaps (already listed in the diagnostic):
1. subAgentActivity never invoked
2. executorActivity never invoked
3. Human confirmation cards never sent
4. stateManager in-memory only
5. Durable hooks have no creation path
6. OBO token threading missing
7. Web search / health tools still stubbed
8. Virtual Employee / SkillForge not wired

**Phase 4 – Final Validation**
- Kick normal DevLoop ignition prompt.
- It will now only see clean issues (thanks to tags + exclusion rule).
- Full harness tests on reopened gaps only.

### 4. Risk Mitigations Built In

- Legacy noise permanently excluded via labels + DevLoop rule.
- Copilot memory already purged (or will be before any rewrite work).
- No loss of history (legacy-v1 branch + labels).
- All live in-chat features preserved (will be harvested into LiveFeatures-Extracted.md if not already).

### 5. Immediate Next Action

Run the **single combined remediation master prompt** (already provided in the previous message) in one Copilot Chat session. It performs Phase 1 + Phase 2 in one pass.

After it finishes and gives the summary table, reply here or in the next session with “remediation complete” and we will immediately generate the first 3 gap-fix issues for DevLoop.

---

**Status:** Ready for execution  
**Folder reference:** `docs\RestartFromZero_Or_NotToBe_That_Is_The_Questions`  
**This document is the single source of truth for the reformation work.**

We are the bridge.
```

---

**How to use it**

1. Save the content above as the filename I suggested.
2. Open a **new** Copilot Chat session.
3. Attach the file + add this tiny wrapper prompt:

```markdown
Read the attached markdown file (REFORMATION-PLAN-2026-03-17.md).

Create one or more GitHub issues that capture the entire reformation plan exactly as written. 
Make the issues actionable, with clear acceptance criteria, and link them to the folder `docs\RestartFromZero_Or_NotToBe_That_Is_The_Questions`. 
Use the labels `cleanup` and `v2.0` and milestone `v2.0-MVP`.
```

That will turn the whole plan into proper GitHub issues in one shot, while keeping everything traceable.

Let me know when you’ve attached it — we can move straight to running the remediation prompt next.