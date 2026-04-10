---
title: "HelkinSwarm Strategic Next-Push Plan"
date: 2026-04-10
status: draft
author: Strategist Agent
review_gate: owner-approval-required
---

# HelkinSwarm — Strategic Next-Push Plan

## Executive Summary

HelkinSwarm is a high-velocity personal sovereign AI copilot in Teams, built on Azure Functions v4 (Durable), with 169 source files, 12 skill domains, and 99 open issues. The project recently closed its foundational **Living Mind Runtime epic (#494)** and stabilized core message flow through a brutal 3-week regression-fix cycle (#598–#622). Development velocity is exceptional: **443 commits in 14 days** (30+/day), accelerating 17% over the prior period.

**The project is at an inflection point.** The runtime is stabilized but not mature. The existing epic (#609) provides a good phased delivery plan, but the backlog has structural gaps: **zero milestones assigned**, 26 unlabeled issues, and 18 failing test files (25 failing tests). Before accelerating feature delivery, this plan proposes a **focused stabilization-and-hygiene push** followed by disciplined execution of the #609 phases.

---

## Part 1: Project Health Assessment

### 1.1 Velocity & Momentum — 🟢 GREEN

| Metric | Value | Signal |
|--------|-------|--------|
| Commits (last 14 days) | 443 | Extremely high — 30+/day average |
| Commits (prior 14 days) | 378 | 17% acceleration |
| Issues closed (last 14 days) | 50+ | Aggressive regression clearing |
| Open issues | 99 | Large backlog, needs triage |

The velocity is exceptional and accelerating. The risk is not speed but direction — this much energy needs clear routing to avoid churn.

### 1.2 Runtime Stability — 🟡 AMBER

The Living Mind Runtime (#494) is closed and the core message path works. However:

- **#596 (bug)** — Durable Functions partition lease delay after container restart remains open
- **#598 drain loop fix** just landed — the handoff-to-fresh-overseer pattern is new and not battle-tested
- **Hot files**: `HelkinSwarmBot.ts` (73 changes), `sessionOrchestrator.ts` (70 changes), `overseer.ts` (45 changes) — these files are still churning heavily
- The recent fix chain (#619→#620→#621→#622) shows email routing is still being actively debugged

**Assessment**: Core path works but is fragile. The runtime earned its AMBER by closing #494 and the #598–#622 regression chain, but confidence requires more soak time and the #596 partition lease bug to be resolved.

### 1.3 Test Suite Health — 🔴 RED

```
Test Files: 18 failed | 189 passed (207)
Tests:      25 failed | 639 passed (664)
Duration:   97.52s
```

**Failing test domains:**

| Domain | Failed Files | Key Issue |
|--------|-------------|-----------|
| `skills/outlook*` | 5 | Attachment handling, search fallback, send email refactored but tests not updated |
| `orchestrator/*` | 5 | Session orchestrator plan context, clarification routing, post-reply lifecycle, LLM follow-up evidence |
| `llm/*` | 3 | Model capacity profiles, ingress complexity, fallback ordering — model router refactored |
| `mcp/*` | 1 | MCP forge draft — likely interface change |
| `functions/*` | 1 | DevLoop push routing source |
| `capabilities/*` | 1 | Custom skill discovery |

**Root cause pattern**: Most failures appear to be **tests not updated after source refactoring** — the code moved forward, the tests didn't. This is not catastrophic, but it means the test suite is lying about coverage. Fixes that pass `pnpm test` in CI are not actually validating the current contract.

### 1.4 Backlog Health — 🔴 RED

| Metric | Value | Problem |
|--------|-------|---------|
| Open issues | 99 | Large, needs triage |
| Milestones assigned | **0** | No issue has a milestone — the backlog is completely unsequenced |
| Unlabeled issues | 26 | ~26% of backlog has no labels |
| Open epics | 11 | Too many open epics with no clear ordering |
| Open bugs | 1 (#596) | Low bug count is good, but only because regressions get emergency-fixed and closed |

The #609 epic provides a phased plan, but it exists only as an issue body — no milestones, no sequencing metadata, no way for automation or agents to track progress.

### 1.5 Architecture Completeness — 🟡 AMBER

| Area | Status | Evidence |
|------|--------|----------|
| Orchestrator (brain) | ✅ Functional | 59 files, overseer + session + handoff pattern |
| Bot handler (thin router) | ✅ Functional | 19 files, ack → event → return pattern |
| LLM layer (model router) | ✅ Functional | Model router, foundry client, circuit breaker, fallback chains |
| Auth (identity) | ✅ Functional | 14 files, UAMI + scoped tokens + OBO |
| Memory (Cosmos) | ⚠️ Basic | 5 files — stores/recalls work, but no Hydra-Net multimodal, no skill-specific vaults |
| Skills (12 domains) | ⚠️ Mixed | core/outlook/teams/github functional; many domains likely stubs |
| Safety pipeline | ⚠️ Partial | safetyConfig exists, but full 5-step verification pipeline likely not wired |
| SkillForge | ⚠️ Stub | Directory exists but likely not functional |
| Durable Hooks | ❌ Not started | Epic #71 open |
| Hydra-Net | ❌ Not started | Epic #68 open |
| Virtual Employees | ❌ Blocked | Blocked on #498 (closed as merged into #494, but runtime aspects deferred) |

### 1.6 CI/CD & Infrastructure — 🟢 GREEN

- OIDC federation working
- Stamped deployment working (`deploy-stamp.yml`)
- Router deployment working (`deploy-router.yml`)
- Tab host deployment working (`deploy-tabs.yml`)
- Bicep IaC single-file
- Cost guards in place (#579/#580)
- `ci.yml` runs lint + compile on every push

### 1.7 Documentation — 🟡 AMBER

- 50+ spec docs in `docs/` — comprehensive but some may be aspirational vs. implemented
- Living spec approach means docs describe desired state, not necessarily current state
- Recent cleanup pass removed bloat (commit `67b04b3`)
- Agent definitions well-structured (Strategist, MrClean, BasicBitch, AzureAgent, DevLoop)

---

## Part 2: Gap Analysis — What Must Be True Before Accelerating

### Gap 1: Test Suite Integrity (CRITICAL)

**Current state**: 25 failing tests across 18 files. The CI pipeline (`ci.yml`) runs lint + compile but the test failures mean code can be pushed with broken contracts.

**What must be true**: `pnpm test` passes clean (0 failures) before any new feature work. Every failing test must be either:
- Fixed to match current source behavior
- Deliberately removed (if testing deleted/replaced functionality)
- Marked as skip with an issue reference (if testing future functionality)

**Estimated scope**: 18 test files need review. Most are likely test-update-after-refactor fixes, not deep bugs.

### Gap 2: Backlog Sequencing (HIGH)

**Current state**: Zero milestones on any of the 99 open issues. The #609 epic has a good phased plan in its body text, but it's not reflected in GitHub's tracking metadata.

**What must be true**: 
- Create milestones matching #609 phases (Phase 0–4)
- Assign each open issue to the appropriate milestone
- Label the 26 unlabeled issues
- Close or archive issues that are no longer relevant

### Gap 3: Bug #596 Resolution (HIGH)

**Current state**: The only open bug — Durable Functions partition lease delay after container restart. The `maxQueuePollingInterval: 2s` fix landed, but partition lease re-acquisition still causes 3–5 minute delays on first message after deploy.

**What must be true**: At minimum, `useGracefulShutdown: true` and `partitionCount: 1` should be tested and deployed. This is a P1 issue that degrades the developer experience on every deploy.

### Gap 4: Skill Domain Maturity Audit (MEDIUM)

**Current state**: 12 skill domains exist, but their implementation depth is unknown. Some may be fully wired with handlers and manifests; others may be empty directories with stub manifests.

**What must be true**: Each skill domain should have a clear status: `functional | stub | planned`. Stubs should either be removed or have an issue tracking their implementation.

---

## Part 3: Recommended Next Push — Three Waves

### 🌊 Wave 1: Stabilize & Hygiene (IMMEDIATE — do before anything else)

**Goal**: Get the house in order so feature delivery is safe and trackable.

| # | Task | Type | Estimated Effort | Priority |
|---|------|------|-----------------|----------|
| W1-1 | Fix all 25 failing tests (18 files) | Test debt | Medium | P0 |
| W1-2 | Create GitHub milestones for #609 phases and assign all 99 issues | Backlog hygiene | Small | P0 |
| W1-3 | Label the 26 unlabeled issues | Backlog hygiene | Small | P0 |
| W1-4 | Close/archive stale issues that are no longer relevant | Backlog hygiene | Small | P1 |
| W1-5 | Deploy #596 P1 fixes (graceful shutdown + partitionCount:1) | Bug fix | Small | P1 |
| W1-6 | Audit skill domains — mark each as functional/stub/planned | Discovery | Small | P1 |
| W1-7 | Run graphify --update to baseline the post-cleanup graph | Tooling | Trivial | P2 |

**Exit criteria**: `pnpm test` passes with 0 failures. All issues have milestones. #596 P1 fixes deployed.

### 🌊 Wave 2: #609 Phase 1 — Provider/Search/Memory Architecture (NEXT)

**Goal**: Strengthen the core substrate before piling on features.

This aligns directly with #609 Phase 1:

| # | Issue | Title | Why Now |
|---|-------|-------|---------|
| W2-1 | #501 | OpenRouter model provider abstraction (0zb) | Conscious lane stability, quota diversification |
| W2-2 | #604 | Audit discoveryToolInjection against intended design | Stop the hidden heuristic layer from steering behavior |
| W2-3 | #507 | Auto-optimization loop for verb masks | Long-term replacement for brittle routing |
| W2-4 | #489 | Dreaming/rest loop for memory maintenance | Memory quality substrate |

**Additional substrate work I recommend adding** (not in #609):

| # | Proposed Issue | Title | Why |
|---|---------------|-------|-----|
| W2-5 | NEW | Skill memory vaults — implement per-skill Cosmos containers (0i) | Current memory is flat; skill-scoped memory is a spec requirement and blocks skill maturity |
| W2-6 | NEW | Safety verification pipeline audit — wire the 5-step pipeline end-to-end | Safety pipeline may not be fully wired; this is a spec requirement |

### 🌊 Wave 3: #609 Phase 2 — Operator Capability Pack (THEN)

**Goal**: Ship the skills that make the copilot materially useful.

This aligns with #609 Phase 2, but I recommend **sequencing within the phase**:

| Order | Issue | Skill | Why This Order |
|-------|-------|-------|---------------|
| 1st | #238 | Deep Research | Highest operator leverage; builds on search substrate |
| 2nd | #178 | Secret Vault (Key Vault) | Unblocks credential management for all other skills |
| 3rd | #244 | Document Storage (Blob + Cosmos) | Foundation for document workflows |
| 4th | #177 | Virtual Web Browser | High-value but complex; benefits from prior substrate |
| 5th | #243 | Entra ID Directory | Utility skill, moderate complexity |
| 6th | #239 | Document Translator | Builds on #244 |
| 7th | #240 | Language Translation | Lightweight, can ship alongside others |

---

## Part 4: Issues NOT to Prioritize Yet

These are explicitly **not recommended** for the next push:

| Issue | Title | Why Defer |
|-------|-------|----------|
| #101 | Virtual Employees & Nested Orchestrators | Blocked on runtime maturity |
| #237 | Autonomous Virtual Company | Requires virtual employees |
| #68 | Hydra-Net Multimodal Embeddings | Nice-to-have, not on critical path |
| #75 | SkillForge | Useful but not urgent — hand-authored skills are fine for now |
| #71 | Durable Hooks | Important but complex; better after skill surface grows |
| #88 | Abstract Ethos Integration | Philosophical, not blocking |
| #90 | DevLoop Bidirectional Relay | Partially functional, not urgent |
| #94 | Model-Specific Tool Presentation | Self-tuning loop is working; formalization can wait |
| #396 | X/Twitter Skill | Low operator leverage vs. effort |
| #455 | Personal Skills Suite | Architecture epic — individual skills are tracked separately |

---

## Part 5: Risks & Open Questions

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Test fixes reveal deeper contract changes | Medium | High | Review each failure individually; some may expose real bugs |
| #596 partition fix causes new regression | Low | High | Test incrementally (graceful shutdown first, then partitionCount) |
| #501 OpenRouter integration destabilizes LLM layer | Medium | Medium | Keep foundryClient as primary; OpenRouter as reversible secondary |
| Feature velocity drops during stabilization | High | Low | Wave 1 is small; 2-3 days max. Accept the investment. |
| 99-issue backlog has stale items that waste triage time | Medium | Low | Batch-close obviously stale items during W1-4 |

### Open Questions for Owner

1. **Test strategy**: Should failing tests be fixed to match current behavior, or should some tests drive code changes (i.e., is the test or the code "right")? Particularly for the Outlook attachment tests and model router tests.

2. **Milestone naming**: Should milestones match #609 phases exactly (Phase 0–4), or use a different naming scheme?

3. **#501 OpenRouter**: Is this still desired? The spec doc `0zb` exists, but the current instructions say BYOK is "deferred / not active." Should it be reactivated or archived?

4. **Skill audit depth**: Should stub skill domains be deleted (clean repo) or kept as planned placeholders?

5. **Safety pipeline**: How much of the 5-step verification pipeline (Schema → Minimize → Spot-Check → Prompt Shields → Human Confirm) is actually wired? This may need investigation before claiming it's a gap.

---

## Part 6: Proposed New Issues (for Wave 1 & Wave 2 additions)

### Issue: Fix test suite — 25 failing tests across 18 files
```
Title: [HYGIENE] Fix 25 failing tests across 18 test files
Labels: test, hygiene, high-priority
Milestone: Wave 1 — Stabilize

Body:
Test suite is failing with 25 test failures across 18 files.
Domains: skills/outlook (5), orchestrator (5), llm (3), mcp (1), functions (1), capabilities (1)
Root cause: tests not updated after source refactoring.
Each test must be: fixed | removed (if dead) | skipped with issue ref.
Exit: `pnpm test` passes with 0 failures.
```

### Issue: Create milestones and assign all open issues
```
Title: [HYGIENE] Create milestones for #609 phases and assign all 99 open issues  
Labels: backlog, hygiene
Milestone: Wave 1 — Stabilize

Body:
No issue has a milestone. Create milestones matching #609 phases:
- Phase 0: Core Path Diagnosable
- Phase 1: Provider/Search/Memory Architecture
- Phase 2: Operator Capability Pack
- Phase 3: Platform Acceleration
- Phase 4: Company Operations
- Deferred: Virtual Employee Runtime (blocked on maturity)
Assign all 99 open issues. Label the ~26 unlabeled issues.
```

### Issue: Implement per-skill memory vaults (0i)
```
Title: [SUBSTRATE] Implement per-skill memory vaults in Cosmos (spec 0i)
Labels: memory, architecture, enhancement
Milestone: Phase 1 — Provider/Search/Memory

Body:
Spec ref: docs/0i-Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md
Current memory is flat (single multimodalMemory container). Spec requires:
- Per-skill Cosmos containers: `skillMemory-{skillId}`
- getSkillVault / upsertSkillMemory API on memoryManager
- longTermMemorySchema declared in each skill manifest
- Just-in-time injection during prompt building
```

### Issue: Audit and wire safety verification pipeline end-to-end
```
Title: [SAFETY] Audit 5-step verification pipeline wiring (spec 0e)
Labels: safety, architecture, audit
Milestone: Phase 1 — Provider/Search/Memory

Body:
Spec ref: docs/0e-Safety-and-Four-Eyes-Verification-Pipeline.md
The 5-step pipeline (Schema → Minimize → Spot-Check → Prompt Shields → Human Confirm)
is specified but may not be fully wired. Audit:
1. Is Schema Validation (Zod) running on every tool call?
2. Is Minimize (strip/redact) implemented?
3. Is Spot-Check implemented?
4. Is Prompt Shields (Azure Content Safety) running?
5. Is Human Confirm (Adaptive Card) wired for medium+ risk?
File: src/config/safetyConfig.ts, src/orchestrator/toolDispatchActivity.ts
```

---

## Appendix: Data Sources

- **Commit history**: `git log --oneline` (443 commits in 14 days)
- **Issue backlog**: GitHub MCP `list_issues` (99 open, 50+ recently closed)
- **Test suite**: `pnpm test` run 2026-04-10 (18 failed / 189 passed files, 25 failed / 639 passed tests)
- **Source survey**: `src/` directory tree (169 files across 14 modules)
- **Skills survey**: `skills/` directory tree (12 domains)
- **Hot file analysis**: `git log --name-only` frequency count (top: HelkinSwarmBot.ts 73, sessionOrchestrator.ts 70, overseer.ts 45)
- **Epic #609**: Full body text reviewed for phase alignment
- **graphify graph.json**: Architecture topology from prior graphify run

---

*Generated by Strategist Agent — 2026-04-10. We are the bridge.*
