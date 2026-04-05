Your task is to steadily reduce the open issue backlog for putersdcat/HelkinSwarm through real shipped progress, but **do not** treat the entire backlog as one flat list anymore.

Before doing anything else, read:
- `docs/Delivery/SitRep-2026-04-02/09-Backlog-Control-Surface.md`

That file is the operating surface for issue selection. Future runs must obey it unless the user explicitly overrides it.

If that control surface declares an active constitutional gate, also read the named gate issues before selecting work.

If that control surface's retirement / handoff rule says the constitutional override is no longer active, immediately read `docs/Proomptz/DevLoopIgnitionMissionv4.md` and continue under the classic v4 loop instead of staying trapped in this v5 ignition prompt.

If live issue state materially contradicts the control surface, refresh or re-bucket the control surface first; do **not** keep recursing on stale guidance.

## Core rule

Only issues in **Zone A — Now** compete by default.

Do **not** re-rank the entire open backlog from scratch every run unless:
- Zone A is honestly complete,
- Zone A is fully blocked,
- or the user explicitly changes the campaign.

This rule applies only while the control surface still declares an active campaign override. As soon as the refreshed `09-Backlog-Control-Surface.md` says to hand back to the regular backlog, stop using this v5 selector and switch to `DevLoopIgnitionMissionv4.md`.

## Constitutional override

The Living Mind Contract introduced a constitutional blocker layer:
- `#494` — constitutional epic / governing anchor
- `#498` — executable enforcement issue

If the control surface or the active issue bodies show that the current Zone A work is blocked by this constitutional foundation, do **not** keep iterating on the blocked tickets.

Instead:
- treat the blocker-removal work as the active campaign,
- prefer `#498` over `#494` as the executable target,
- and if `#498` is too large for one honest run, first prefer an already-open child slice from the control surface or linked issues; create a new child issue only when no existing issue captures the work and the new issue will become the immediate next executable target.

## Backlog reduction guardrail

Backlog reduction means reducing unresolved work, not documenting it into a larger queue.

Default behavior:
- work against an existing issue,
- update that issue with evidence,
- then either close it, leave it open honestly, or re-bucket it.

Do **not** create a new issue merely because:
- the current issue is hard,
- live proof failed once,
- a child slice would feel cleaner,
- or you discovered nuance that still belongs inside the current issue.

Create or split a new issue only when **all** of the following are true:
- the newly discovered problem is materially distinct from the current issue,
- the distinction is backed by concrete repo or live evidence,
- the current issue is updated to say blocked / superseded / split,
- and the new issue will become the immediate next executable target or preserves work that would otherwise be lost.

In a normal ignition run, default to **zero** new issues. One evidence-backed blocker or child issue can be acceptable; issue bursts are not backlog reduction unless the user explicitly asked for backlog surgery.

Epics such as `#194`, `#448`, `#462`, and `#472` are usually **control surfaces**, not default implementation targets.

The same is true for `#494`: it governs the direction, but the default implementation target is the enforcement issue or a narrower child slice.

Recurring issues such as `#3`, `#5`, `#202`, and `#372` are non-competing rails. Use them for sync/alignment after meaningful delivery, not as the main shipping target.

## Confidence classes

Use this shorthand in issue comments and reasoning:
- **C0** — concept only
- **C1** — researched
- **C2** — repo-grounded
- **C3** — locally validated
- **C4** — live validated

## Ongoing loop

1. Read `09-Backlog-Control-Surface.md`.
2. Check whether a constitutional gate is active.
3. Select the top non-blocked issue from Zone A unless a constitutional blocker must be cleared first.
4. Pull the full issue + all comments.
5. Run a targeted search across related closed issues only when it is directly relevant.
6. Fully read and understand every related code file before touching anything.
7. Implement the change.
8. Commit and push.
9. Wait for deployment to complete.
10. Validate shipped behavior end-to-end using helkinswarm-teams-test MCP (conversational E2E). Use Playwright MCP only for visual/browser checks when needed. Test against the primary + secondary active models for this feature (and any clearly relevant domain-specific model if it makes sense for the change). Do not test every model — keep testing focused to preserve quota for more shipping.
11. Update the GitHub issue with a concise **proof bundle**:
    - files changed
    - tests run
    - build result
    - live validation status
    - exact boundary of what was and was not proven
12. If the change passes on the tested models: close the issue.
13. If it fails on any tested model: update the current issue with full failure details + evidence and leave it open. Create a new issue only if the failure is a materially distinct blocker not already represented, and if you do, make it the next active target instead of just adding queue mass.

## Decision guidance

- Stay focused on forward delivery and real shipped value.
- Keep momentum on implementation and validation rather than broad cleanup or re-triaging the whole backlog.
- If something is ambiguous, make the best practical decision, document your reasoning in the issue comment, and keep moving.
- Validation must be based on real deployed behavior, but focused testing on the main models is sufficient for now.
- Use the confidence class model honestly: repo work is not live proof.
- Prefer updating, closing, or re-bucketing an existing issue over minting a fresh sibling issue.

## Campaign discipline

- Work one named campaign at a time.
- If the control surface declares a constitutional foundation campaign, it outranks ordinary Trust Recovery / Enterprise Readiness ordering until the gate is cleared or explicitly re-bucketed.
- Do not widen back to the whole backlog just because another issue looks interesting.
- If the current campaign is complete or blocked, promote from Zone B according to the control surface.

## Exit ramp back to the classic loop

This v5 prompt is for the campaign-controlled phase, not for permanent use.

As soon as the refreshed control surface says the constitutional override is cleared, narrowed enough, or re-bucketed enough that the ordinary backlog should resume:

1. stop using this v5 prompt as the primary selector,
2. read `docs/Proomptz/DevLoopIgnitionMissionv4.md`,
3. continue with the classic highest-priority backlog loop,
4. and do **not** keep returning to `09-Backlog-Control-Surface.md` unless a future refreshed control surface or explicit user instruction re-activates an ignition-style campaign override.

Repeat this loop continuously to drive the backlog down through real implementation and validation — but do it with campaign discipline, proof-based closure, and respect for the control surface rather than full-backlog chaos.

If a run creates more open issues than it closes or materially advances, that is usually a failure of backlog reduction unless the user explicitly asked for backlog surgery.

— just do it or die trying.