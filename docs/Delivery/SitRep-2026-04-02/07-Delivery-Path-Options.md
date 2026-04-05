# Delivery Path Options — Decision Draft

## Purpose

This document turns the SitRep research into concrete delivery-path options.

Each path answers the same question differently:

> What should HelkinSwarm optimize for over the next delivery wave, given that the architecture is broadly real but the product edge still has truthfulness and continuity drift?

The options below are intentionally opinionated and mutually distinguishable. They can later be blended, but only after choosing a primary bias.

---

## Path A — Stability and Truthfulness First

### Core idea

Freeze broad surface expansion for one focused correction wave and make the currently shipped app feel **trustworthy, legible, and operationally honest**.

### Why choose this path

Choose this if the top priority is:
- restoring owner confidence in what the app claims
- reducing “looks delivered, feels confusing” moments
- making future expansion safer because the readiness/status model becomes trustworthy first

### What this path would focus on

#### Wave 1A — skill operational-state truth

Primary backlog:
- `#484` — distinguish loaded/installed from operational state
- `#371` — use the existing rollout-standard docs as enforcement input
- `#194` — Skills Library system epic (only the honesty/review sub-slice, not broad expansion)

Likely concrete work:
- introduce an explicit runtime skill state model:
  - `loaded`
  - `installed`
  - `action-required`
  - `operator-setup-required`
  - `blocked`
  - `operational`
- update `inspectSkillInstall()` semantics
- update Skills Library badges and readiness copy
- use `web` and `graphenterprise` as proof cases

#### Wave 1B — follow-up execution proof

Primary backlog:
- `#485` — follow-up skill verification drift
- `#479` — Outlook discovery-to-execution drift
- `#431` / `#408` / `#400` — only as historical comparison and regression references, not as the main target

Likely concrete work:
- add deterministic handling for “test it / verify it / prove it” follow-up shapes after a skill has already been surfaced
- reduce user-facing discovery narration when execution proof is possible
- add regression probes for discovery → demonstrate transitions

#### Wave 1C — response-discipline cleanup

Potential work:
- soften or reframe end-user strings like:
  - `I stayed in discovery-only mode`
  - `I did not reach an executable tool from discovery`
- keep detailed orchestration-state phrasing for logs/dev surfaces, not normal user chat unless explicitly helpful

### What gets deprioritized temporarily

- broad new skill expansion
- large new M365 admin surface area
- ambitious new MCP/SkillForge polish beyond fixes already in flight

### Success criteria

This path is successful when:
- the Skills Library tells the truth about operational readiness
- `graphenterprise` and `web` no longer create misleading “ready but not really” states
- follow-up verification prompts can either execute or decline cleanly
- end-user chat feels less like an orchestration console

### Risks

- can feel slower in visible feature count
- may feel like “cleanup” even though it is structurally important

### Best fit

Best if the goal is:

> **Make the current product believable before making it bigger.**

---

## Path B — Dual-Track: Trust Fixes + Controlled Enterprise Progress

### Core idea

Run two tracks in parallel:

- **Track 1:** product-edge correction
- **Track 2:** continue Microsoft/M365/admin progress, but only behind stronger rollout gates

### Why choose this path

Choose this if the top priority is:
- not losing momentum on enterprise/admin capabilities
- while still addressing the trust debt that the SitRep exposed

### Track 1 — correction lane

Same priorities as Path A, but tightly scoped:
- `#484`
- `#485`
- `#479`
- response-discipline cleanup where it clearly affects normal chat UX

### Track 2 — controlled enterprise/admin expansion

Primary backlog:
- `#462` — Microsoft MCP control plane epic
- `#472` — M365 operational admin sub-epic
- `#473` / `#474` / `#476`
- `#243`

Rule for this track:
- no new enterprise/admin capability should be presented as broadly usable until it passes the tighter readiness/operational model developed in Track 1

### Gating principle

This path only works if Track 2 is constrained by the outputs of Track 1.

If Track 2 outruns Track 1, you recreate the same drift problem with a larger and more confusing surface area.

### Success criteria

- trust fixes are visibly landing in parallel
- enterprise/admin momentum continues
- new admin skills are launched with stronger status honesty than older ones

### Risks

- requires discipline
- easy to let the exciting admin work starve the honesty/correction work
- can create cognitive overload if too many fronts move at once

### Best fit

Best if the goal is:

> **Keep strategic Microsoft/admin momentum without accepting more UX-trust erosion.**

---

## Path C — Enterprise Operations First

### Core idea

Lean hard into the M365 / Microsoft control-plane direction and treat the current UX/readiness problems as secondary polish that can be tightened later.

### Why choose this path

Choose this only if the top priority is:
- reaching useful Microsoft 365 / Entra operational capability as fast as possible
- accepting short-term user-facing roughness to get there sooner

### Main backlog emphasis

- `#462`
- `#472`
- `#473`
- `#474`
- `#476`
- `#243`
- related identity architecture threads like `#447`

### Benefits

- fastest route to “top worker/admin co-pilot” substance
- keeps current strategic Microsoft investments moving
- may generate the most obviously valuable admin outcomes fastest

### Risks

This path is the most dangerous according to the SitRep.

Why:
- it normalizes more “inspectable/discoverable but not fully operational” states
- it increases the chance of confusing follow-up/test requests in end-user chat
- it lets product-edge trust debt compound under more high-stakes capabilities

### Success criteria

- actual usable admin workflows emerge quickly
- but this only truly succeeds if the trust debt does not visibly worsen

### Best fit

Best if the goal is:

> **Push hard toward enterprise/admin usefulness now and accept higher short-term roughness.**

### SitRep stance

This is **not** the recommended default path.

---

## Path D — Platform Hardening First

### Core idea

Instead of centering user-visible UX, focus first on the enabling platform seams that govern long-term reliability and scaling of the skills ecosystem.

### Why choose this path

Choose this if the top priority is:
- making the skills/MCP ecosystem easier to manage over time
- reducing future platform entropy
- preparing for more disciplined growth rather than immediately improving current UX

### Main backlog emphasis

- `#448` — McpForge epic
- `#481` — MCP provenance/update monitoring
- `#482` — orchestrator fallback into MCP registry candidate search
- `#75` — SkillForge
- `#194` — only the platform/schema/lifecycle aspects

### Likely work

- provenance/update metadata
- readiness/preflight infrastructure usable across skills
- more formal lifecycle/state handling for integrated skills
- capability exposure gating improvements at the platform layer

### Benefits

- strong long-term payoff
- gives future skills a better substrate
- could reduce repeated rollout drift for new capability families

### Risks

- may not improve the user-visible experience quickly enough
- can feel abstract while the current product edge is still causing confusion now

### Best fit

Best if the goal is:

> **Reduce future platform drift before shipping many more capability families.**

---

## Path E — Two-Step Recovery Plan (Recommended)

### Core idea

This is the synthesized path I would recommend based on the research.

It is effectively:

1. a **short, aggressive correction tranche**
2. followed immediately by a **controlled dual-track expansion tranche**

### Step 1 — Recovery tranche (short, focused)

Duration target:
- one concentrated delivery wave / sprint

Primary issues:
- `#484`
- `#485`
- `#479`
- selective UX/response-discipline cleanup tied directly to those paths

Objectives:
- make skill state truthful
- make follow-up verification less slippery
- reduce orchestration-heavy user-facing phrasing
- establish a hard “operational enough to expose” bar

### Step 2 — Controlled expansion tranche

Once Step 1 lands:
- continue `#462` / `#472` / `#473` / `#474` / `#476`
- continue MCP platform hygiene under `#448`, `#481`, `#482`
- continue other skill expansion only when they comply with the stronger readiness model

### Why this is the best default

Because the SitRep evidence suggests:
- the architecture is not fundamentally broken
- many recent slices are real and worth building on
- but the product edge is currently soft enough to undermine confidence in that real progress

So the best move is not to stop momentum forever.
It is to **buy back trust quickly**, then expand again on firmer ground.

---

## Decision table

| If your top priority is... | Best path |
|---|---|
| Maximum near-term trust and coherence | Path A |
| Keep enterprise/admin momentum without worsening trust debt | Path B |
| Reach admin capability fastest, even if rough | Path C |
| Strengthen ecosystem substrate before more growth | Path D |
| Best balanced default based on current research | Path E |

---

## My recommendation right now

If I were steering the next tranche from this SitRep alone, I would choose:

## **Path E — Two-Step Recovery Plan**

### Why

1. It respects the fact that the current architecture and many recent closures are real.
2. It directly addresses the two strongest current trust gaps:
   - skill operational-state honesty
   - follow-up execution-proof behavior
3. It avoids the morale hit of a long feature freeze.
4. It gives the Microsoft/M365 direction a better platform for believable rollout.

### What I would do first under Path E

#### First slice
- `#484`
- `#485`
- `#479`

#### Then immediately after
- `#462`
- `#472`
- `#476`
- `#481`
- `#482`

---

## Suggested next decision conversation

The next owner-level question should probably be:

> Do we want to optimize the next tranche for **trust recovery**, **strategic Microsoft/admin momentum**, or a **deliberate two-step blend of both**?

If helpful, the next refinement step can turn the chosen path into:
- a concrete 1–2 sprint sequence
- issue ordering
- explicit pause/defer list
- acceptance criteria for when to move from tranche 1 into tranche 2
