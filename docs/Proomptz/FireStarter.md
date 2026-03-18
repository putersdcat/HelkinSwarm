# Phase 0.5 — Backlog Initialization Prompt

## AUTHORITY DECLARATION

**This prompt governs Phase 0.5 exactly. You will follow it without softening, without summarizing, and without creative interpretation. Every instruction is non-negotiable. If you are uncertain about any requirement, re-read this prompt — the answer is here. Do not proceed with partial understanding.**

You are creating the complete GitHub issue backlog for HelkinSwarm. Every issue you create will be implemented by a developer who has never read the specification. The issue body IS the specification for that unit of work. Shallow issues produce broken code. You will not produce shallow issues.

---

## STEP 0 — READ EVERYTHING FIRST

Before creating a single issue, you MUST read — in full, cover to cover — every one of the following files. Do not skim. Do not summarize from memory. **Read them now.**

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

### Structural Reference (not verbatim)
- `scripts/Create-Backlog.ps1` — use as a structural skeleton and ordering reference only. It is stale. Issue titles, bodies, milestones, and Phase structure in THIS prompt override anything in the script. Do not copy issue bodies from the script without enriching them to meet the standards below.

---

## STEP 1 — CREATE MILESTONES

Create these milestones in this exact order before any issues exist:

| Milestone | Title |
|-----------|-------|
| `v0.0` | `v0.0 - Bootstrap` |
| `v0.1 - Research Gate` | `v0.1 - Phase 0.75: Architecture Research Gate` |
| `v0.2 - Stamped Infra & Core` | `v0.2 - Stamped Infra & Core` |
| `v0.3 - Eternal Brain & Router` | `v0.3 - Eternal Brain & Router` |
| `v0.4 - LLM & Safety` | `v0.4 - LLM & Safety` |
| `v1.0 - MVP` | `v1.0 - MVP Complete` |
| `v1.1+ - Post-MVP` | `v1.1+ - Self-Improvement & Post-MVP` |

---

## STEP 2 — CREATE THE TWO NEVER-CLOSE ISSUES FIRST

Before any other issues, create both Never-Close issues using the exact content from `docs/Delivery/01-Recurring-Maintenance-and-Introspection-Issues.md`. Pin both to the top of the repository.

1. **[RECURRING] Codebase Health & Documentation Alignment — Never Close**
   - Labels: `recurring-maintenance`, `never-close`, `documentation`
   - No milestone (permanent)

2. **[RECURRING] Architecture & Design Introspection Pass — Never Close**
   - Labels: `recurring-maintenance`, `never-close`
   - No milestone (permanent)

---

## STEP 3 — ISSUE QUALITY STANDARD (NON-NEGOTIABLE)

Every issue you create MUST contain ALL of the following. No exceptions.

### A. Exact Spec Section References
State the precise document(s) and section(s) that define this work. Not just the filename — the specific section within the document. Example: "`0e-Safety-and-Four-Eyes-Verification-Pipeline.md` Section 3: Executor Agents".

### B. Architectural Context — Why This Exists in the Digital Body
Every issue must include a short paragraph explaining WHERE this component sits in the digital body metaphor and WHY it matters. The overseer is the brain. Skills are reflexes. Memory vaults are long-term recall. Hydra-Net is the senses. The safety pipeline is the immune system. A developer reading this paragraph must understand the architectural purpose — not just the mechanical task.

### C. Non-Negotiable Constraints (Explicitly Stated)
Do NOT assume the developer knows the project's constraints. State them in the issue body. If the issue touches auth, state "UAMI only — no client secrets, no PATs." If the issue touches the LLM, state "LLM never receives auth tokens." If the issue touches deployment, state "deploy-stamp.yml with userAlias — no cd.yml." These must be visible in the issue, not buried in a spec the developer hasn't read.

### D. Acceptance Criteria That Validate Running Code
Acceptance criteria must be testable against a deployed system. "Implement the module" is not acceptance criteria. "POST /api/health returns 200 with component breakdown including overseer status" IS acceptance criteria. Every criterion must answer: "How do I prove this works in production?"

---

## STEP 4 — MANDATORY INVARIANTS

The following invariants MUST appear **explicitly in the body of every relevant epic and issue**. These are the constraints that get silently violated when issues are shallow. You will embed them as a visible "Invariants" section wherever they apply.

### 1. Safety Pipeline Is Mandatory and NEVER Bypassable
The four-eyes verification pipeline (0e) runs on every tool output, every SkillForge creation, every destructive action. There are NO bypass flags. No `bypassSafety`. No `SKIP_VERIFICATION`. No `isTestMode` that disables checks. If you find yourself tempted to add an escape hatch — stop. The pipeline is the immune system. You do not disable your immune system.
**Applies to:** Every epic that touches tool dispatch, safety, SkillForge, executor agents, or LLM output.

### 2. UAMI Only — Zero Secrets in Code
User-Assigned Managed Identity is the only production auth mechanism. No client secrets. No PATs. No service principal passwords. `DefaultAzureCredential` for local dev falls back to `az login`. Key Vault stores anything that isn't a managed identity.
**Applies to:** Every epic that touches auth, deployment, Key Vault, or Azure SDK usage. (Spec: doc 11)

### 3. LLM Never Receives Auth Tokens; LLM Never Executes Destructive Actions
The LLM reasons and proposes. It never holds credentials. It never directly executes delete/move/create operations. Executor agents (non-LLM code paths) handle all destructive actions after the verification pipeline approves. The LLM's output is a recommendation, not an execution.
**Applies to:** Every epic that touches LLM, tool dispatch, safety pipeline, or executor agents. (Spec: 0e, 11)

### 4. EU Residency Is a Single Bicep Parameter — Zero Code Changes
`param euResidencyMode bool = false` in Bicep. When set to `true`, EVERY resource, EVERY model deployment, and EVERY Cosmos container switches to EU endpoints. No code changes. No config file edits. No conditional logic in TypeScript. The Bicep template alone controls data residency.
**Applies to:** Every epic that touches infrastructure, LLM, memory, or deployment. (Spec: 0q, 03)

### 5. Multi-Instance Stamping Is Table Stakes from Day One
Every deployment is a stamped user instance. `userAlias` parameter is required on all resources. Resource names follow `helkinswarm-{resourceType}-{alias}`. Resource groups follow `rg-HelkinSwarm-{alias}`. `deploy-stamp.yml` is the ONLY deployment workflow. There is no `cd.yml`. There is no "default" deployment. The first deployment IS a stamped instance.
**Applies to:** Every epic that touches infrastructure, deployment, CI/CD, or resource naming. (Spec: 0q)

### 6. Global Frontier Models Are Default — Model Names Never Hardcoded
The system uses the best available global frontier models by default for maximum performance. EU-compliant DataZoneStandard models are the fallback when `euResidencyMode = true`. Model names are NEVER hardcoded in TypeScript. They come from config/env vars set by Bicep. The model router resolves the correct model at runtime.
**Applies to:** Every epic that touches LLM, model routing, or Foundry integration. (Spec: 06)

### 7. Adding a New Skill Requires Zero Changes to `src/`
The `skills/` directory is auto-discovered via capability manifests. Drop a `manifest.json` + tool files into `skills/<domain>/` and the capability loader picks it up. If your implementation requires editing anything in `src/` to add a new skill, the architecture is broken.
**Applies to:** Every epic that touches capabilities, modularity, tool dispatch, or SkillForge. (Spec: 0a)

### 8. Delegate to Native Automation First
Every skill manifest declares `externalAutomationCapabilities`. Before building a polling loop or a timer trigger, check if the external system (Exchange, Graph, GitHub) already has native automation (rules, subscriptions, webhooks). Use it first. Build custom automation only when native delegation is impossible.
**Applies to:** Every epic that touches skills, durable hooks, long-running workflows, or integrations. (Spec: 0l)

### 9. Skill-Scoped Memory Vaults + Just-in-Time Injection — Context Never Bloated
Each skill gets its own isolated memory vault (`skillMemory-{skillId}`). Memory is injected into sub-agent prompts just-in-time, only for the active skill, only the top-K relevant chunks. The overseer prompt NEVER carries all skill memories. The digital body recalls only what it needs for the current action.
**Applies to:** Every epic that touches memory, orchestration, prompt building, or skill execution. (Spec: 0i)

### 10. "We Are the Bridge" Permeates Every Persona Prompt
The Culture ethos (0l) is not decoration. It is the operational directive. Every persona template, every system prompt, every agent definition carries the bridge metaphor and the Special Circumstances mandate. The digital body knows what it is.
**Applies to:** Every epic that touches persona, prompt building, agent definitions, or ethos. (Spec: 0l)

---

## STEP 5 — CREATE ALL ISSUES

Use `scripts/Create-Backlog.ps1` as a structural ordering reference. The script defines the phases, epics, and individual issues. Enrich every issue body to meet the quality standard in Step 3 and embed the relevant invariants from Step 4.

### Phase ordering:
1. **Phase 0 (v0.0 - Bootstrap)** — Repo scaffold, Bicep, CI/CD, health endpoint, agent system (already completed in commit `be9e4e5`)
2. **Phase 0.75 (v0.1 - Research Gate)** — Architecture research: Global Router + Stamping Design. Zero code. Decision issues only.
3. **Phase 1 (v0.2 - Stamped Infra & Core)** — First stamped deployment, Teams bot, auth, E2E foundation. `deploy-stamp.yml` is the ONLY deployment path.
4. **Phase 2 (v0.3 - Eternal Brain & Router)** — Eternal overseer, session orchestrator, Global Teams Router.
5. **Phase 3 (v0.4 - LLM & Safety)** — Model routing, tool dispatch, four-eyes verification pipeline.
6. **Phase 4 (v1.0 - MVP)** — Memory, SkillForge, Hydra-Net, observability, integrations. MVP complete.
7. **Phase 5 (v1.1+ - Post-MVP)** — DevLoop relay, self-tuning, virtual employees, BYOK.

### Special handling:
- **Agent System Epic** (`[EPIC] Agent Definitions & Instruction System`): Create this issue under milestone `v0.0 - Bootstrap`. In the body, note that this was completed in Phase 0 commit `be9e4e5`. Immediately after creation, close the issue with a comment: "Completed in Phase 0. Commit: be9e4e5. Agent files and instruction system are live."

---

## STEP 6 — POST-CREATION QUALITY AUDIT

After all issues are created, pick 10 issues at random (ensure at least one from each phase) and ask yourself:

> "Would a developer reading ONLY this issue — without access to the specification — implement it correctly?"

For each issue:
- Does it state the exact spec section(s)?
- Does it explain the architectural context (digital body role)?
- Does it list every non-negotiable constraint that applies?
- Are the acceptance criteria testable against a running system?
- Are the relevant invariants from Step 4 explicitly embedded?

If the answer is NO for any issue, **rewrite it before proceeding**. Do not move to Step 7 with shallow issues.

---

## STEP 7 — FINALIZE

Add a comment to **Issue #1** (`[MASTER PLAN] HelkinSwarm Bootstrap Playbook` or whatever the master tracker is titled) with the following:

1. Total number of issues created (by phase)
2. Total number of epics created
3. Confirmation that all milestones exist: `v0.0`, `v0.1 - Research Gate`, `v0.2 - Stamped Infra & Core`, `v0.3 - Eternal Brain & Router`, `v0.4 - LLM & Safety`, `v1.0 - MVP`, `v1.1+ - Post-MVP`
4. Confirmation that both Never-Close issues are created and pinned
5. Confirmation that the Agent System epic is created and closed (commit `be9e4e5`)
6. Confirmation that the post-creation quality audit passed

---

## FINAL REMINDERS

- The specification is the source of truth. When in doubt, re-read the spec.
- `Create-Backlog.ps1` is a structural reference, not gospel. Its issue bodies are stale — enrich them.
- Every invariant violation in production traces back to a shallow issue. Write them deep.
- This is a personal sovereign AI copilot. It runs in a personal tenant. The developer IS the owner.
- Safety is enforced by architecture, not by prompts or flags.

**We are the bridge.**

Begin now.