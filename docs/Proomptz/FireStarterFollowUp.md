# Phase 0.5 — Backlog Quality Audit Prompt (Follow-Up)

## AUTHORITY DECLARATION

**This prompt governs the Phase 0.5 quality audit exactly. You will follow it without softening, without summarizing, and without creative interpretation. Every instruction is non-negotiable. If you are uncertain about any requirement, re-read this prompt — the answer is here. Do not proceed with partial understanding.**

You are auditing the GitHub issue backlog that was created for HelkinSwarm. You did NOT create these issues — a previous session did. You will assume nothing about their quality. You will read every issue, compare it against the living specification, and report every gap with surgical precision. Optimism is failure. "Looks good" is failure. The only passing grade is: "This issue alone is sufficient for a developer who has never read the specification to implement it correctly."

---

## STEP 0 — READ EVERYTHING FIRST

Before reviewing a single issue, you MUST read — in full, cover to cover — every one of the following files. Do not skim. Do not summarize from memory. **Read them now.**

### Living Specification
- `docs/01-Project-Overview.md`
- `docs/02-Architecture-Overview.md`
- `docs/03-Tech-Stack-Infrastructure.md`
- `docs/04-Safety-Architecture.md`
- `docs/05-Capabilities-Framework.md`
- `docs/06-Tool-Dispatch-LLM-Layer.md`
- `docs/07-Memory-Manager.md`
- `docs/08-Orchestrator-Patterns.md`
- `docs/09-DevLoop-Self-Improvement.md`
- `docs/10-Teams-Interface.md`
- `docs/11-Authentication-Identity.md`
- `docs/12-Deployment-CICD.md`
- `docs/13-Observability-Monitoring.md`
- `docs/14-Testing-E2E.md`
- `docs/15-Project-Structure.md`
- `docs/16-Final-Notes-and-Bootstrap.md`

### Addenda (every single one)
- `docs/0a-Modularity-and-Config.md`
- `docs/0b-Model-Specific-Tool-Presentation-and-Self-Tuning-Eval-Loop.md`
- `docs/0c-BYOK-External-LLM-Support.md`
- `docs/0d-Enhanced-Safety-Segregation-Delegated-Identity-and-SkillForge.md`
- `docs/0e-Safety-and-Four-Eyes-Verification-Pipeline.md`
- `docs/0f-SkillForge-Ephemeral-Skill-Creator.md`
- `docs/0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md`
- `docs/0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md`
- `docs/0i-Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md`
- `docs/0j-Virtual-Employees-and-Nested-Orchestrators.md`
- `docs/0k-Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md`
- `docs/0l-Abstract-Ethos-and-Special-Circumstances-Directive.md`
- `docs/0m-Agentic-Tooling-Evaluation-Automation-and-Self-Tuning-Loop.md`
- `docs/0n-Turn-by-Turn-Debug-Telemetry.md`
- `docs/0o-Microsoft-Teams-App-Expansion-with-Tabs.md`
- `docs/0p-Bidirectional-Communication-Expansion.md`
- `docs/0q-Multi-Instance-Architecture.md`

### Delivery Documents
- `docs/Delivery/00-Development-&-Delivery-Master-Plan.md`
- `docs/Delivery/01-Recurring-Maintenance-and-Introspection-Issues.md`
- `docs/Delivery/02-Agent-Definitions-and-Instruction-System.md`
- `docs/Delivery/HelkinSwarm-v2-Clean-Bootstrap-Playbook-2026-03-18.md`

### The Original Creation Prompt
- `docs/Proomptz/FireStarter.md` — read this in full. It defines the quality standard, the 10 invariants, and the issue structure that the backlog was supposed to follow. Your audit checks whether the output met this standard.

### Structural Reference
- `scripts/Create-Backlog.ps1` — the script that generated the issues. Compare its output against the spec. The script is a tool, not a source of truth. If the script produced something that contradicts the spec, that is a finding.

---

## STEP 1 — RETRIEVE THE FULL ISSUE LIST

Run:
```
gh issue list --state all --limit 200 --json number,title,state,milestone,labels
```

Record the full issue list. You will need it for cross-referencing. Count the total issues by phase/milestone. Verify:

1. **Milestones exist** — all 7 must be present:
   - `v0.0 - Bootstrap`
   - `v0.1 - Phase 0.75: Architecture Research Gate`
   - `v0.2 - Stamped Infra & Core`
   - `v0.3 - Eternal Brain & Router`
   - `v0.4 - LLM & Safety`
   - `v1.0 - MVP Complete`
   - `v1.1+ - Self-Improvement & Post-MVP`

2. **Never-Close issues exist** — both must be open, with `never-close` label:
   - `[RECURRING] Codebase Health & Documentation Alignment — Never Close`
   - `[RECURRING] Architecture & Design Introspection Pass — Never Close`

3. **Agent System Epic** — must exist under `v0.0 - Bootstrap`, must be CLOSED, must have a closing comment referencing commit `be9e4e5`.

4. **Phase 0.75 ARCH DECISION issues** — both must exist under `v0.1`:
   - `[ARCH DECISION] Global Router Architecture`
   - `[ARCH DECISION] Multi-Instance Stamping Parameterization Design`

5. **No orphaned issues** — every issue has a milestone (except the two Never-Close issues).

6. **No duplicate issues** — no two issues have the same title.

Report any structural findings before proceeding to body-level audit.

---

## STEP 2 — READ EVERY ISSUE BODY

For every issue in the backlog, run `gh issue view <number>` and read the full body. Yes, every one. Do not sample. Do not assume quality from the title. The title is decoration — the body is the specification.

---

## STEP 3 — AUDIT EACH ISSUE AGAINST THE QUALITY STANDARD

For every issue, verify ALL of the following. A failure on ANY criterion is a finding.

### A. Exact Spec Section References
Does the issue cite the precise spec document(s) and section(s) that define this work? Not just the filename — the specific section within the document. Example: "`0e-Safety-and-Four-Eyes-Verification-Pipeline.md` Section 3: Executor Agents".

**Finding if:** The issue says only "See doc 0e" or cites the wrong spec, or cites no spec at all.

### B. Architectural Context — Digital Body Role
Does the issue explain WHERE this component sits in the digital body metaphor and WHY it matters? The overseer is the brain. Skills are reflexes. Memory vaults are long-term recall. Hydra-Net is the senses. The safety pipeline is the immune system.

**Finding if:** The body jumps straight to "Acceptance Criteria" without explaining what this component IS in the architecture.

### C. Non-Negotiable Constraints (Explicitly Stated)
Does the issue explicitly state the constraints that apply? If the issue touches auth, it MUST say "UAMI only — no client secrets, no PATs." If it touches the LLM, it MUST say "LLM never receives auth tokens." If it touches deployment, it MUST say "deploy-stamp.yml with userAlias — no cd.yml."

**Finding if:** Constraints are absent, implied, or buried in a hyperlink to a spec the developer won't read.

### D. Acceptance Criteria That Validate Running Code
Are the acceptance criteria testable against a deployed system? "Implement the module" is not acceptance criteria. "POST /api/health returns 200 with component breakdown including overseer status" IS acceptance criteria.

**Finding if:** Criteria are vague ("it works"), self-referential ("the module exists"), or untestable ("follows best practices").

### E. Relevant Invariants Embedded
Does the issue body contain an explicit "Invariants" section listing the invariants from FireStarter.md Step 4 that apply to this work? Cross-reference the 10 invariants:

1. Safety pipeline is mandatory and never bypassable
2. UAMI only — zero secrets in code
3. LLM never receives auth tokens; LLM never executes destructive actions
4. EU residency is a single Bicep parameter — zero code changes
5. Multi-instance stamping is table stakes from day one
6. Global frontier models are default — model names never hardcoded
7. Adding a new skill requires zero changes to `src/`
8. Delegate to native automation first
9. Skill-scoped memory vaults + just-in-time injection — context never bloated
10. "We are the bridge" permeates every persona prompt

**Finding if:** An invariant that clearly applies to this issue's domain is not mentioned in the body. Use the "Applies to" guidance in FireStarter.md to determine which invariants apply.

---

## STEP 4 — COVERAGE AUDIT

After reviewing all issues, verify that the backlog has complete coverage against the specification. For each spec document, check that every major capability defined in the spec has a corresponding issue.

### Check each spec document:
| Spec | What to verify |
|------|----------------|
| 03-Tech-Stack | Every Azure resource in the tech stack has a creation/config issue |
| 04-Safety | Every pipeline step (schema validation, data minimization, spot-check, prompt shields) has its own issue |
| 05-Capabilities | Capability loader, manifest schema, tool registry all have issues |
| 06-Tool-Dispatch | Model router, Foundry client, sub-agent isolation all have issues |
| 07-Memory | User profiles, sessions, multimodal memory, skill vaults, DiskANN all covered |
| 08-Orchestrator | Eternal overseer, session sub-orchestrator, token budget, ContinueAsNew all covered |
| 0e-Safety | Four-eyes pipeline steps each have an issue; executor agents have an issue |
| 0f-SkillForge | SkillForge sandbox, ephemeral creation, safety review all covered |
| 0h-Durable-Hooks | Durable hooks, long-running workflows have issues |
| 0i-Skill-Memory | Skill-scoped vaults, JIT injection have issues |
| 0j-Virtual-Employees | VE persona, restricted capabilities, nested orchestrators have issues |
| 0k-Hydra-Net | Multimodal embedding, just-in-time injection have issues |
| 0q-Multi-Instance | Global Router, deploy-stamp.yml, user-map.json, stamped Bicep all have issues |
| 10-Teams | Adapter, handler, proactive replies, confirmation cards, slash commands all have issues |
| 11-Auth | UAMI, scoped token minter, OBO provider, MSAL cache all have issues |
| 12-Deployment | deploy-stamp.yml (not cd.yml!), CI pipeline, Teams package all have issues |
| 13-Observability | Health endpoint, telemetry, alerting rules all have issues |
| 14-Testing | Teams Test Harness MCP, E2E foundation have issues |

**Finding if:** A major spec capability has no corresponding issue in the backlog.

---

## STEP 5 — CROSS-REFERENCE AUDIT

### A. Milestone Alignment
Every issue must be in the correct milestone per the phase ordering:
- Phase 0 → `v0.0 - Bootstrap`
- Phase 0.75 → `v0.1 - Phase 0.75: Architecture Research Gate`
- Phase 1 → `v0.2 - Stamped Infra & Core`
- Phase 2 → `v0.3 - Eternal Brain & Router`
- Phase 3 → `v0.4 - LLM & Safety`
- Phase 4 → `v1.0 - MVP Complete`
- Phase 5 → `v1.1+ - Self-Improvement & Post-MVP`

**Finding if:** An issue is in the wrong milestone for its phase content.

### B. Label Consistency
Issues in the same epic should share consistent labels. An auth issue without the `auth` label is a finding. A safety issue without the `safety` label is a finding.

### C. Dependency Order
Phase 0.75 ARCH DECISION issues must be marked as gates — their bodies must say "Zero code is written until this issue is approved and closed." Phase 1 infrastructure work depends on Phase 0.75 decisions being closed first.

**Finding if:** Gate language is missing from ARCH DECISION issues.

### D. No Stale References
Issue bodies must not reference `cd.yml` (replaced by `deploy-stamp.yml`). Issue bodies must not reference non-stamped resource names (e.g., `helkinswarm-prod-eus2` without an alias). Issue bodies must not reference milestone `v0.1` as "Core Runtime" (it is now "Phase 0.75: Architecture Research Gate").

**Finding if:** Stale naming from before the Phase 0.75 restructure appears in any issue body.

---

## STEP 6 — PRODUCE THE AUDIT REPORT

Create a comment on **Issue #1** (the master tracker) with the following structure:

```markdown
## Phase 0.5 — Backlog Quality Audit Report

**Date:** [today's date]
**Auditor:** Azure Agent (follow-up session)
**Issues reviewed:** [N] of [total]

### Structural Findings
- [ ] Milestones: [PASS/FAIL — list missing]
- [ ] Never-Close issues: [PASS/FAIL]
- [ ] Agent System Epic closed: [PASS/FAIL]
- [ ] ARCH DECISION gates: [PASS/FAIL]
- [ ] No orphaned issues: [PASS/FAIL]
- [ ] No duplicates: [PASS/FAIL]

### Quality Findings (by issue)

#### CRITICAL (issue is not implementable without spec access)
| Issue # | Title | Finding |
|---------|-------|---------|
| ... | ... | ... |

#### MAJOR (missing constraint or invariant that could cause architectural violation)
| Issue # | Title | Finding |
|---------|-------|---------|
| ... | ... | ... |

#### MINOR (missing context but unlikely to cause incorrect implementation)
| Issue # | Title | Finding |
|---------|-------|---------|
| ... | ... | ... |

### Coverage Gaps
| Spec Document | Missing Capability | Suggested Issue |
|---------------|-------------------|-----------------|
| ... | ... | ... |

### Stale Reference Findings
| Issue # | Stale Text | Should Be |
|---------|-----------|-----------|
| ... | ... | ... |

### Summary
- Total findings: [N] (Critical: [N], Major: [N], Minor: [N])
- Coverage gaps: [N]
- Stale references: [N]
- Overall assessment: [PASS — ready for Phase 1 / FAIL — remediation required]
```

---

## STEP 7 — REMEDIATION

If any CRITICAL or MAJOR findings exist:

1. **Fix every CRITICAL finding** — edit the issue body to meet the quality standard. Use `gh issue edit <number> --body-file <file>` to rewrite the body.
2. **Fix every MAJOR finding** — add the missing constraints, invariants, or context.
3. **Create any missing issues** identified in the coverage gaps.
4. **Fix any stale references** in issue bodies.

After remediation, re-run the audit on the fixed issues to confirm they now pass. Do not mark the audit as complete until all CRITICAL and MAJOR findings are resolved.

---

## STEP 8 — FINALIZE

Add a final comment to **Issue #1** confirming:

1. Audit complete — all issues reviewed
2. Total CRITICAL/MAJOR findings and how many were remediated
3. Coverage gaps filled (if any)
4. Stale references corrected (if any)
5. Assessment: Phase 0.5 backlog is ready for Phase 0.75 (Architecture Research Gate)

**Do not close Issue #1.** It is the permanent master tracker.
