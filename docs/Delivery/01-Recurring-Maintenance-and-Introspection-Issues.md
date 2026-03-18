# HelkinSwarm Unchained – Development & Delivery Plan
## 01. Recurring Maintenance & Architecture Introspection Issues (Never Close)

**Version:** 1.0  
**Status:** Permanent Backlog Items  
**Purpose:** These two issues are created once (ideally after Phase 2 or 3 when the core runtime and safety pipeline are stable) and are **explicitly never closed**. They serve as living, self-perpetuating maintenance engines that keep the codebase, documentation, and architectural integrity aligned forever.

They are designed to be triggered by humans or agents after every major milestone, Epic delivery, or significant architecture change.

---

### 1. [RECURRING] Codebase Health & Documentation Alignment — Never Close

**State:** OPEN (create this issue after Phase 2 or 3)

#### Description
<!-- ========================================================
     NEVER CLOSE THIS ISSUE
     This is a recurring maintenance task. It should be
     re-triggered after every major milestone, Epic delivery,
     or significant architecture change. Add a dated comment
     with execution summary each time it is picked up.
     ======================================================== -->

> ### This issue is NEVER closed.
> It is a **recurring maintenance trigger**. After each major milestone or significant delivery, an agent (or human) picks this up, executes a review + update pass, and drops a dated comment summarising what was done. The checklist below resets partially on each run — check what's genuinely stale, fix it, and leave everything else alone.

#### Purpose
HelkinSwarm is a fast-moving project. Between feature sprints the connective tissue can drift: the README falls behind, the living specification no longer perfectly matches the code, dead scripts or artifacts accumulate, and domain-specific guidance for future AI-agent sessions becomes outdated.

This issue is the forcing function to fix all of that, periodically and systematically.

**Trigger criteria** (any one is sufficient):
- A milestone has been closed or is near-close
- A major Epic has been delivered
- More than 4 weeks since the last run
- A significant architecture change has landed
- A new contributor is onboarding and the documentation feels misaligned

#### Standing Checklist (review & re-execute each run)

**README.md**
- Ensure all high-level descriptions, quick-start steps, architecture overview, and "What It Does" section match current capabilities
- Verify local development workflow, CI/CD flow, and bootstrap instructions are accurate and tested
- Confirm any diagrams or example commands reflect the current global-first architecture with EU toggle support

**Living Specification (Docs/)**
- Confirm 01-Project-Overview.md through 16-Final-Notes-and-Bootstrap.md plus the complete 0a–0l addendum series (and 0m) remain perfectly aligned with implemented code
- Check that all cross-references, principles, and "What NOT to Do" sections are still valid
- Verify any newly added capabilities or patterns are reflected in the appropriate document

**Domain-Specific Guidance & Instructions**
- Review all instruction files and ensure they still accurately describe current patterns for orchestrator, safety pipeline, memory, SkillForge, DevLoop, and tool dispatch
- Confirm the DevLoop ignition prompt and test-harness guidance remain current

**Dead Code & Artifacts**
- Identify and remove or gitignore any orphaned scripts, screenshots, snapshots, or temporary files
- Scan for noisy console.log statements or legacy debugging code and route them through structured observability where appropriate

**Security & Compliance Spot Check**
- Verify `.env.example` contains no real secrets and only documents current required variables
- Confirm local configuration files are properly gitignored
- Ensure emergency stop and maintenance mode mechanisms are still wired and documented

**Package & Dependency Hygiene**
- Run dependency health checks and confirm no outdated or vulnerable packages are present

**GitHub Hygiene**
- Review open issues for correct labelling and milestone alignment
- Ensure recurring maintenance and never-close labels are still active and properly applied

#### Deliverable for each run
Add a dated comment with:
- Trigger for this pass
- Summary of what was reviewed and updated
- Any new issues created as a result
- Confirmation that the living specification and codebase remain in sync

---

### 2. [RECURRING] Architecture & Design Introspection Pass — Never Close

**State:** OPEN (create this issue after Phase 2 or 3)

#### Description
<!-- ========================================================
     NEVER CLOSE THIS ISSUE
     This is a recurring architectural introspection task.
     Re-trigger after major Epics, architecture changes, or
     every 4–6 weeks. Add a dated comment with findings.
     ======================================================== -->

> ### This issue is NEVER closed.
> This is a recurring **introspection + architectural alignment** trigger.
> Unlike the codebase health pass, this issue is about stepping back after major deliveries and asking the higher-order questions:
> - What would we build differently now?
> - Where have newer patterns clearly surpassed older implementations?
> - What should be backported before drift becomes debt?
> - Are we still fully aligned to core safety, modularity, and ethos constraints?

#### Purpose
As HelkinSwarm grows, incremental velocity can hide system-level drift. This recurring issue forces periodic higher-order reflection across completed work, implementation history, architectural decisions, and present-day code reality.

The goal is intellectual refactoring of the whole system direction — not housekeeping — before we get painted into corners.

**Trigger criteria** (any one is sufficient):
- Major Epic completed or materially reshaped
- Significant architecture or safety change landed
- More than 4 weeks since last introspection pass
- "This feels harder than it should" signal appears during development
- Repeated patterns or bugs suggest old design assumptions are leaking

#### Standing Checklist (re-run each pass)

**1. Pattern Evolution Review**
- Identify places where newer modules solve problems more cleanly than legacy paths
- Propose targeted backports of superior patterns (without full rewrites)
- Flag duplicated logic where a single canonical implementation should exist

**2. Objective-to-Reality Audit**
- Confirm outcomes from recently delivered Epics still hold in the current architecture
- Verify early assumptions and design decisions remain valid
- Highlight where "done then" has become only "partially true" today

**3. Safety & Security Constraint Alignment**
- Re-verify enforcement of the four-eyes verification pipeline, scoped tokens, executor agents, and least-privilege boundaries
- Confirm no newer flows silently bypass original guardrails
- Flag any design drift that could increase blast radius

**4. Forward Architecture Anti-Cornering**
- Re-evaluate whether the current trajectory risks locking us into avoidable constraints
- Identify extension points (SkillForge, DevLoop, Virtual Employees, Hydra-Net) that need hardening before the next growth wave
- Capture concrete "do now to avoid pain later" items

**5. Technical Debt Early-Warning**
- Find schema, model, or capability expansions that were not propagated to older paths
- Identify TODO clusters or complexity spikes tied to core runtime flows
- Spot areas where modularity or digital-body ethos could be strengthened

**6. Operational Coherence**
- Validate that observability, test harnesses, and diagnostics still map to real failure modes
- Confirm recurring signals are feeding architectural improvements rather than just patches

#### Deliverable for each run
Every run adds a dated comment with:
1. What changed in our understanding
2. What should remain exactly as-is
3. What must be refactored or backported next
4. Which new issues were created or updated as a result
5. Any explicit risk calls (safety, scalability, reliability)

---

**Creation Guidance**  
Create both issues **after Phase 2 or 3** (once the overseer and safety pipeline are stable).  
Apply the label `recurring-maintenance` and `never-close` to both.  
Pin them at the top of the repository issue list for visibility.

These two issues, together with the DevLoop ignition prompt, form the permanent self-sustaining maintenance engine of HelkinSwarm.

---