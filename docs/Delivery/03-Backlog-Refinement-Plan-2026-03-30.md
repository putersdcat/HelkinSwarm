# Backlog Refinement Plan — 2026-03-30

## Purpose

This document proposes a **backlog refinement mini-project** for HelkinSwarm based on the **live GitHub open backlog**.

The goal is not to cosmetically reduce issue count. The goal is to make the backlog:

- easier for agents to read without drowning in historical comment sludge
- clearer about which issues are canonical, active, recurring, parked, or archival
- safer against repeat failures like bulk-closing valid backlog items
- more useful as the operating surface for future delivery

## Current live snapshot

- Live open issues audited at planning time: **42**
- Source of truth: GitHub live issue state

## What the backlog currently contains

The live open backlog is not one thing. It is a mixture of five very different kinds of issues:

1. **Canonical recurring governance issues**
2. **Architecture / MVP epics and their concrete sub-issues**
3. **Security / infra hardening tracks**
4. **Future-skill / research parking-lot items**
5. **Forward-looking virtual-company concept work**

That mixture is the real source of friction. Agents have no single obvious signal for whether an open issue is:

- ready for delivery now
- intended to remain open indefinitely
- a parking-lot concept
- a historical container for previous audit logs
- or an umbrella issue that should not be implemented directly

## Inventory by recommended category

### 1) Canonical recurring issues — keep open, mostly leave alone

These should remain open and should **not** be treated like normal delivery tickets:

- `#3` — `[RECURRING] Codebase Health & Documentation Alignment`
- `#5` — `[RECURRING] Architecture & Design Introspection Pass`
- `#202` — `[RECURRING] Living Documentation Sync – Track docs/ against dev deliveries`
- `#372` — `[RECURRING] DevLoop Delivery → Docs Sync (core features first)`

### 2) Governance / historical tracker to intentionally close

- `#1` — `[MASTER PLAN] HelkinSwarm Bootstrap Playbook`

This issue should be **closed intentionally**, not because it is invalid, but because it has finished its real job.

Recommended closure note:

- preserve it as a historical bootstrap record
- explicitly say it can help troubleshoot future stamp bootstrap failures
- note that it should inform tightening and eventual full automation of the bootstrap path

In other words: keep the history, stop pretending it is a live delivery issue.

### 3) MVP / architecture epics and concrete sub-issues

- `#68`, `#69`, `#70`
- `#71`
- `#75`, `#76`, `#77`, `#78`
- `#88`
- `#90`
- `#94`
- `#101`, `#102`, `#103`
- `#194`, `#197`, `#199`, `#200`, `#201`

These are the strongest candidates for structured refinement because they represent actual architecture and delivery work rather than pure historical logging.

### 4) Security / infra hardening cluster

- `#212` — current hardening umbrella with multiple grounded status comments
- `#392` — explicit phase-2 network-plane follow-on

This cluster is conceptually valid, but `#212` is already accumulating a long evidence trail. It needs a compact current-state synopsis so future agents do not have to read the entire archaeology dig before contributing.

### 5) Research / future-skill parking lot

- `#157`, `#161`, `#162`
- `#176`, `#177`, `#178`, `#179`, `#180`
- `#207`

These are legitimate backlog items, but they are not all equal.

The correct move is **not** to bury them. The correct move is to separate:

- highly desired personal-user skills that are not core to the autonomous-virtual-employee objective
- future strategic skills that may need a lighter-weight near-term variant
- long-horizon north-star capabilities that should remain visible without distorting immediate delivery priorities

### 6) Virtual-company future operating model

- `#237`
- `#238`–`#246`
- `#249`

This set is coherent, but it needs more nuance than a simple “future only” bucket. Some of these skills are relevant **now** for the top-level human-facing stamp and should also be built in a way that future virtual employees can inherit them later.

## Specific hygiene problems already visible

### A. Comment chains becoming a delivery tax

This is real. The danger is not only token overflow. The danger is also **semantic drift**:

- old comments remain technically true but operationally obsolete
- new comments become status logs rather than delivery instructions
- an agent reads a long history and loses the actual current ask

The clearest current candidates are:

- `#1`
- `#212`

The recurring issues also have long histories, but there the comments are often the intended artifact, so they should be treated more conservatively.

### B. Mixed issue semantics

Right now the backlog contains open issues that mean very different things:

- “implement this feature”
- “keep this permanently open”
- “historical roadmap anchor”
- “future research maybe someday”

That ambiguity is what enables bad agent behavior like “zero-open-backlog” thinking.

## Recommended operating model going forward

I recommend dividing backlog work into **five lanes** and making the lane explicit in the issue body and/or labels.

### Lane A — Recurring / never-close

Use for issues whose purpose is to remain open and accumulate dated run reports.

Examples:
- `#3`, `#5`, `#202`, `#372`

Policy:
- keep open
- do not close for hygiene
- avoid rewriting history
- only compact if the issue becomes materially unreadable

### Lane B — Active delivery

Use for issues that a coding agent could reasonably implement in the near term.

Examples:
- `#69`, `#70`, `#76`, `#77`, `#78`, `#197`, `#199`, `#200`, `#201`

Policy:
- concise body
- clear acceptance criteria
- minimal historical chatter
- current dependencies summarized near the top

### Lane C — Epic / umbrella

Use for issues that coordinate work but should not themselves become sprawling execution diaries.

Examples:
- `#68`, `#71`, `#75`, `#101`, `#194`, `#237`

Policy:
- body should define scope and child issues
- comments should mostly note major scope changes, not full debugging transcripts

### Lane D — Parked research / future-skill

Use for valid ideas that are not current delivery priorities.

Examples:
- `#157`, `#161`, `#162`, `#176`, `#180`

Policy:
- keep open if useful
- tag clearly as parked / research / future
- avoid large status-comment accretion unless active work resumes

### Lane E — Historical / archival meta

Use sparingly for issues whose main value is historical context rather than ongoing work.

Best current candidate:
- `#1`

Policy:
- close it with an explicit historical-preservation comment
- do not let it masquerade as an active delivery ticket if that is no longer true

## Comment-chain compaction strategy

This should be done **carefully** and only after approval.

### Principle

Do not destroy history. **Move the heavy history into the repo, then compress the issue to a current delivery synopsis.**

### Proposed method

For a selected issue:

1. Export the full comment history to a repo file under a dedicated archive folder, e.g.:
   - `docs/Archive/IssueHistories/issue-0212-service-to-service-firewall-rules.md`
2. Preserve:
   - issue title
   - issue number
   - original body snapshot
   - dated comments in chronological order
   - links back to the GitHub issue/comments
3. Create a **single compact synopsis comment** on the live issue with:
   - current status
   - what is already delivered
   - what remains open
   - canonical follow-on issues / dependencies
   - link to the archived repo history file
4. If the issue body has drifted too far from reality, either:
   - rewrite the body to reflect current scope, or
   - open a successor issue and explicitly narrow/retire the old one

### First-wave compaction candidates

Start with the issues where the payoff is highest:

1. `#212` — good evidence, but too much scrolling to reach current truth

### Issues to avoid compacting initially

Leave these alone unless they become painful:

- `#3`
- `#5`
- `#202`
- `#372`

Those are recurring issues whose comments are part of the intended operating record.

## Issue rewrite / split guidance

When an issue should **not** simply accumulate more comments:

### Rewrite the existing issue when

- the issue is still canonical
- the core ask remains the same
- the body is stale, but the issue identity is still correct

Examples likely fitting this pattern:
- `#212`
- some of the MVP sub-issues under `#194`

### Create a successor issue when

- the original issue has become mostly historical
- the real remaining work is narrower than the original ask
- future agents would be misled by the old body even after edits

Best current candidate:
- lightweight strategic variants of research/planning issues where the near-term shippable skill is materially different from the long-form research item

The clearest current example is `#161`:

- keep `#161` as the broader X/Twitter research-and-planning track
- likely create a new higher-priority delivery issue for a **lightweight X integration** that focuses on:
   - account bootstrap feasibility for an AI-only company presence
   - search
   - posting / public communication
   - DM-based communication if platform policy and implementation constraints allow it

That split keeps the broad research issue from blocking a smaller, strategically valuable near-term implementation slice.

## Proposed mini-project phases

### Phase 1 — Inventory and governance rules

Deliverables:
- confirm canonical issue lanes
- document which issues are recurring, epic, active delivery, parked research, or archival/meta
- decide the canonical handling of `#1`

### Phase 2 — No-risk hygiene

Deliverables:
- define backlog rules so agents do not equate “not active now” with “close it”

### Phase 3 — First-wave issue compaction

Deliverables:
- close `#1` with a historical-preservation comment
- archive/compact `#212` if its comment chain keeps growing
- add a compact current-state summary to `#212`

### Phase 4 — Structural refinement of parked work

Deliverables:
- add clearer backlog-priority tags / semantics to parked but desired personal-user skills
- split research/planning parent issues from executable delivery issues where useful
- make active-vs-parked semantics explicit

### Phase 5 — Optional successor / split work

Deliverables:
- if needed, re-author successor issues for items whose bodies are beyond repair
- explicitly link old → new and preserve historical context in repo archive docs

## My recommended order of attack

If you approve this project, I would execute in this order:

1. Create a tracking issue for backlog refinement governance
2. Close `#1` with the agreed historical-preservation framing
3. Compact `#212`
4. Split research/planning parents from near-term delivery children where strategically useful
5. Review whether any other live issues actually need body rewrites now
6. Only then consider broader parked-work taxonomy cleanup

This order maximizes delivery value while minimizing the risk of destructive “cleanup theater.”

## Concrete recommendation summary

### Leave alone for now

- `#3`, `#5`, `#202`, `#372`

### Close intentionally now

- `#1`

### Review first for structural rewrite / compaction

- `#212`

### Treat as active architecture/delivery backlog

- `#68`–`#78`
- `#88`, `#90`, `#94`
- `#101`–`#103`
- `#194`, `#197`, `#199`–`#201`
- `#392`

### Treat as parked / research / future-program backlog

- `#157`, `#161`, `#162`
- `#176`, `#180`

### Treat as long-term but important north-star work

- `#179` — keep open; refine over time, but do not force near-term delivery before the core product is ready
- `#207` — keep open as a standing reminder of the strategic end goal

### Treat as high-priority core-enabling skills

- `#177`
- `#178`

### Treat as future-program umbrella / sequencing-sensitive work

- `#237`
- `#249`

### Treat as usable now for human participant and later for virtual employees

#### Higher priority / should be ready earlier
- `#238`
- `#239`
- `#240`
- `#243`
- `#244`

#### Lower priority / acceptable to defer
- `#241`
- `#242`
- `#245`
- `#246`

## Specific backlog decisions from operator guidance

### `#1` — close as historical bootstrap record

Decision:

- close it
- preserve the history
- comment that it is valuable as a historical reference for future stamp bootstrap troubleshooting and for tightening the process until bootstrap becomes painless and fully automated

### `#157`, `#161`, `#162`, `#176`, `#180` — desired but not core to immediate autonomous-work objective

Decision:

- keep them visible in backlog
- mark/tag them as lower-priority / rainy-day / parked strategic skills
- do not let them compete with the virtual-employee bootstrap and autonomous-work core path

### `#161` — X/Twitter should likely get a lighter-weight strategic delivery child issue

Decision:

- keep the broad research/planning issue
- create a separate, more implementation-focused child issue for a lightweight X capability centered on:
   - bot/company account operation feasibility
   - search
   - outbound communication
   - DM communication where allowed and practical

This becomes the template for a wider rule:

- **research/planning** can remain as a parent or preparatory issue
- **actual delivery** should live in separate executable issues when the implementation slice is concrete enough

### `#179` — voice-to-voice is a major north-star, not a casual skill ticket

Decision:

- keep open
- keep refining
- explicitly treat it as long-term, resource-heavy work with infra, cost, sovereignty, runtime-architecture, and UX implications
- ensure future delivery preserves:
   - chat transcript continuity
   - long-term and persistent memory behavior
   - tool calling
   - sub-session orchestration
   - parity with the existing chat-layer interaction model

This should not be built as a toy demo. It should only be pulled forward when the base application is mature enough to support the larger investment.

### `#177`, `#178` — elevate as top-priority core-enabling skills

Decision:

- treat both as high-priority core skills
- these unlock significant future capability and may become dependencies for many downstream skills

### `#207` — keep open as a standing strategic reminder

Decision:

- keep open
- treat it as a north-star task that becomes actionable once the core technical stack is mature enough to support it credibly

### `#237` — future program, but also part of the deeper MVP intent

Decision:

- treat it as a dedicated post-MVP/future-program umbrella
- but recognize that it expresses the deeper reason many current capabilities exist at all

### `#249` — sequence after virtual-company MVP

Decision:

- keep open
- explicitly sequence it after meaningful virtual-company groundwork exists

### `#238`–`#246` — not all of these are virtual-employee dependent

Decision:

- interpret these as skills for the **chat participant**, which may be either:
   - the human user in the top-level stamp, or
   - a future virtual employee using HelkinSwarm as its operating backbone

That means these should not all be delayed until virtual employees exist.

#### Prioritize for earlier delivery
- `#238` — Deep Research / Extended Research
- `#239` — Document Translator
- `#240` — Language Translation
- `#243` — Entra ID Directory Lookup & Write
- `#244` — AI-Native Lightweight Document Storage

#### Lower priority / acceptable to defer
- `#241` — Image Generation
- `#242` — Cost Estimation & Budgeting
- `#245` — Human Relations & Investor Reporting
- `#246` — Lightweight Ledger / Bookkeeping

## Approval checkpoint

If this plan looks right, the next step should be:

1. create a dedicated backlog-refinement tracking issue
2. implement only the first approved wave
3. verify each change against live GitHub state before touching the next issue

That keeps the mini-project surgical instead of turning backlog maintenance into another source of chaos.