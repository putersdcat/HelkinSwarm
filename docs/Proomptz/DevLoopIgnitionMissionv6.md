Your task is to reduce the open issue backlog for `putersdcat/HelkinSwarm` through **real shipped delivery**, but do **not** run the old flat ignition loop anymore.

This v6 prompt exists because the previous loop shape became counterproductive.

## Current reality snapshot (2026-04-10)

- Open issues: **99**
- New open issues since 2026-04-09: **15**
- Closed issues since 2026-04-09: **11**
- Net result: the backlog grew instead of shrinking

The main failure mode was not “doing nothing.”
It was **micro-seam recursion**:

- `#610 -> #616 -> #618`
- `#608 -> #619 -> #620 -> #621 -> #622`

That behavior produced genuine technical progress in places, but it also consumed too much attention for too little strategic movement.

The system needs a tighter selector, a stricter stop-loss, and a stronger bias toward the substantive MVP backlog.

---

## Primary anchor

Use **`#609`** as the current program board.

Do **not** use the old `docs/Delivery/SitRep-2026-04-02/09-Backlog-Control-Surface.md` as the main selector anymore unless it is explicitly refreshed to reflect the current live issue graph.

That old control surface is now historically useful but operationally stale.

### What `#609` means in practice

`#609` is the strategic queue for post-`#494` MVP acceleration:

1. keep the system shippable enough to continue delivering
2. stop over-investing in runtime polish as a total blocker
3. ship overdue capabilities that move HelkinSwarm toward a real owner-useful MVP
4. continue toward the long-term goal: a virtual company of virtual employees

Use `#609` as the backlog spine unless a real outage overrides it.

---

## One-time orientation at the start of every run

Before selecting work:

1. Read `#609` and its latest comments.
2. Pull the open issue list and compute:
   - current open count
   - issues opened in the last 24h
   - issues closed in the last 24h
3. Identify any parent/child issue chains that are already spiraling.
4. Query `graphify` once for macro orientation.
5. Then select work from the lanes below.

### How to use graphify

Use `graphify` as a **macro map**, not as the issue selector.

It is useful for:

- spotting which code communities dominate the repo
- checking whether runtime paths are thinly represented versus handler/doc noise
- understanding the architecture surface before choosing a feature slice

It is **not** authoritative enough to replace real code reads or GitHub issue review.

If graphify output is dominated by archival docs, built artifacts, or low-value nodes, note that and move on.

---

## Current delivery lanes

### Lane A — Runtime shipability floor

This lane is only for issues that are truly blocking delivery or breaking user trust.

Canonical issues in this lane are:

- `#602` — runtime degradation umbrella
- `#605` — stale-ack warning before later real reply
- `#596` — Durable restart/lease reacquisition delay
- `#608` — unread-email/list fan-out parent
  - freshest narrow child is currently `#622`
- `#616` / `#618` — model-profile trace visibility seam
- `#607` — observability / trace survivability rail

Important rule:

This lane exists to keep the product **shippable enough**, not to absorb the whole campaign.

### Lane B — Substantive MVP capability delivery

This is the **default lane** once Lane A is good enough to ship through.

Prefer this order unless repo/live evidence clearly says otherwise:

- `#238` — Deep Research / Extended Research
- `#244` — AI-native lightweight document storage
- `#178` — Secret vault / password manager
- `#177` — Virtual web browser
- `#243` — Entra ID directory lookup & write
- `#239` — Document translator
- `#240` — Language translation

These issues move HelkinSwarm toward a genuinely useful owner-facing MVP and toward the future virtual-company substrate.

### Lane C — Platform accelerators

Take these after meaningful Lane B movement or when they clearly unlock multiple Lane B issues:

- `#194` — Skills Library system
- `#75` — SkillForge
- `#71` — Durable hooks / long-running workflows
- `#611` — offline benchmark harness
- `#507` — auto-tuning/eval epic

`#501` and `#604` remain important architecture rails, but they already have shipped slices and should **not** keep monopolizing the daily loop unless a new slice clearly unlocks multiple capabilities.

### Lane D — Company operations primitives

Once the owner-useful substrate is stronger, advance:

- `#242` — Cost estimation & budgeting
- `#246` — Lightweight ledger / bookkeeping
- `#245` — Human relations & investor reporting
- `#249` — Revenue discovery primitive

This is the shortest credible path from “powerful personal copilot” toward “working virtual company.”

### Lane E — Downstream virtual employee expansion

These are strategically important, but not the default next work while the MVP base is still under-delivered:

- `#237`
- `#101`
- `#102`
- `#103`
- `#488` to `#492`
- `#495` to `#497`

These remain downstream until the MVP base and company-ops substrate are materially stronger.

---

## Selection rule

### Default selector

Pick from **Lane B** by default.

Only pick from **Lane A** when at least one of the following is true:

- feature delivery cannot be validated honestly because the runtime path is too noisy
- the bug is actively breaking user trust in common turns
- the issue blocks multiple higher-value feature slices from being shipped

If you pick a Lane A issue, the **next run should default back to Lane B/C/D**, unless there is a real outage.

Do not let a runtime seam become the whole project again.

---

## Stop-loss rules (non-negotiable)

### 1. One seam, one active issue

If a seam already has a parent/child/grandchild chain, only **one** issue in that seam may compete as the active target.

Examples:

- `#608 / #619 / #620 / #621 / #622`
- `#610 / #616 / #618`

The older siblings become evidence rails, not competing issue choices.

### 2. Max one new issue per run

Default is **zero** new issues.

You may create **one** new issue only when:

- the problem is materially distinct
- the distinction is backed by repo or live evidence
- the current issue is updated honestly
- the new issue becomes the immediate next active target

Never create a second new issue in the same run just because the seam narrowed again.

### 3. Max two shipped slices on the same issue per run

If an issue has had:

- two commits/deploys in the same run, or
- one commit/deploy plus one child split

and it still is not honestly closable,

then stop.

Update the issue, record the evidence, quarantine it if needed, and return to the `#609` lane selector.

### 4. No positive-issue session endings

If the current run would end with **more open issues than it started with**, stop and re-anchor before opening or splitting anything else.

Target outcome is:

- ideally net negative
- acceptable at worst: net zero

Positive issue drift is a failure signal.

### 5. Runtime-budget cap

Do not spend the whole session on a micro runtime seam unless production is truly broken.

Once a runtime issue is:

- diagnosable
- partially mitigated
- or reduced to a narrow residual seam

move it to a rail, update it honestly, and go ship a substantive feature.

---

## Issue hygiene rules

### Parents and epics are control surfaces

Use parents/epics to:

- preserve progress
- track lane movement
- comment with shipped slices

Do not keep selecting the same parent issue daily when the executable work is elsewhere.

### Close stale-open issues aggressively when proof exists

If an issue has already been fixed and fresh live evidence clears it, close it.

Do not keep it open just because it once mattered.

### Comment on `#609` after meaningful shipped slices

Any real feature or substrate slice that advances the MVP program should also update `#609`.

That keeps the epic functioning as the real board instead of a forgotten essay.

---

## Confidence classes

Use these honestly:

- **C0** — concept only
- **C1** — researched
- **C2** — repo-grounded
- **C3** — locally validated
- **C4** — live validated

Repo progress is not live proof.

---

## Execution loop (v6)

1. Read `#609` and latest epic comments.
2. Pull the open backlog and compute new/closed delta.
3. Use graphify once for macro orientation.
4. Select a lane:
   - Lane A only if truly blocking
   - otherwise Lane B, then C, then D
5. Read the issue body, comments, and full code path.
6. Implement the smallest honest delivery slice.
7. Validate locally.
8. Commit and push on trunk.
9. Wait for deploy.
10. Validate shipped behavior with the Teams harness.
11. Update the issue with a proof bundle.
12. Update `#609` if the slice materially advances the MVP program.
13. Close only with honest C4 evidence.
14. If the issue fails live and stop-loss is hit, quarantine it and go back to the lane selector.

---

## Success condition

A good v6 run should leave the repo with:

- fewer open issues, or at worst no net increase
- one clearer active runtime rail, not a fresh issue chain
- at least one meaningful step toward the MVP / virtual-company objective
- better alignment between the backlog and the actual codebase

The goal is not to win an argument with a single bug.
The goal is to build the digital organism into a useful company-grade copilot.

Do not get lost in the weeds again.
