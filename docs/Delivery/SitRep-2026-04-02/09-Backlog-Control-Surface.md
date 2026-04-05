# Backlog Control Surface — Refreshed 2026-04-05

## Purpose

This is the compact operating surface for repeated backlog-reduction runs.

Its job is to stop the loop from re-ranking the whole backlog every time **and** to stop future runs from getting trapped on stale constitutional guidance after the active seam has materially narrowed.

---

## Core operating rules

### 0. Constitutional blockers outrank ordinary zone order
If the current downstream candidate is still explicitly blocked by the Living Mind foundation (`#494` / `#498`), the run must clear the blocker work first instead of pretending normal backlog order has resumed.

### 1. Use the narrowest honest executable slice
Do **not** keep targeting a stale parent issue when a fresher child now isolates the real failure mode.

That means:
- treat epics and parents as control surfaces,
- but execute the deepest honest child slice when one exists,
- and refresh this file whenever the active blocker narrows materially.

### 2. Closed or superseded slices do not keep competing
If a child issue is already closed, mitigated, or superseded by a narrower blocker, remove it from the active front.

### 3. Recurring issues do not compete with shipping work
These remain important but non-competing:
- `#3`
- `#5`
- `#202`
- `#372`

### 4. Confidence classes
Use this shorthand in comments and reasoning:
- **C0** — concept only
- **C1** — researched
- **C2** — repo-grounded
- **C3** — locally validated
- **C4** — live validated

### 5. Closure discipline
For user-facing issues, closure comments should include:
- files changed
- tests run
- build result
- live validation status
- exact boundary of what was and was not proven

---

## Constitutional Gate — Still Active, But Narrow

The constitutional gate is **not** gone.

But it is no longer the broad 2026-04-02 shape, and it is no longer honest to keep treating stale parents like `#554` or `#555` as the active front.

### Recently cleared and no longer competing

These are off the active front and must not keep pulling future runs backward:

- `#525` — closed
- `#526` — closed
- `#527` — closed
- `#554` — closed
- `#555` — closed
- earlier constitutional bridge/proof slices under `#498` / `#520` already closed in prior runs

### Current live constitutional stack

| Order | Issue | Role | Confidence | Why it is here now |
|---|---|---|---|---|
| 0 | `#498` | Constitutional parent / first-wave enforcement | C3/C4-partial | Still open only because the final living-session continuity / hard-enforcement tranche is not honestly done. |
| 0a | `#516` | Hard single-session enforcement parent | C3/C4-partial | Queue-first safety, active-turn routing, and default-off compatibility are shipped, but the runtime still is not honestly a fully proven single living session. |
| 0b | `#520` | Living event-draining architecture parent | C3/C4-partial | Multi-turn ingress and buffered follower scaffolding exist, but ordinary same-instance drain is still not proven. |
| 0c | `#556` | Buffered-follower architecture parent | C3/C4-partial | The old black-hole symptom is now mitigated by replay/rescue, but ordinary same-instance dequeue/drain is still not honestly proven. |
| 0d | `#566` | Exact-target drain blocker parent | C3/C4-failed | Exact instance targeting shipped, but the original living overseer still did not dequeue/drain the follower itself. |
| 0e | `#567` | Narrowed post-reply parent seam | C3/C4-failed | The stale-ack symptom was reduced, but repeated shipped attempts did not clear the live bar; this is now better treated as the immediate parent for the newer leader-correlation completion seam. |
| 0f | `#568` | Quarantined research rail | C3/C4-failed | Two additional shipped slices (`577993e`, `70308e7`) still failed live. The seam is real, but it is no longer the default daily shipping target without a materially new hypothesis. |

### Supporting open children under the same seam

These still exist in GitHub but should **not** outrank the freshest executable slice unless their issue threads become the current live blocker again:

- `#557` — persist active-processing overseer stage so cross-request ingress can choose buffered path
- `#558` — use Durable `customStatus` for cross-request living-session ingress selection
- `#559` — earlier same-correlation post-reply re-entry seam; recent `#567` / `#568` live evidence is now converging back toward this same architectural clue rather than away from it

### Platform / tech-limit research note (2026-04-05)

This seam has now had enough repeated live pressure that future runs must **not** assume it is still a simple app bug without checking the evidence.

What was checked:

- Microsoft Learn Durable instance-management docs still say that if an orchestration instance exists but is **not yet waiting** for an external event, the event is **stored in instance state until it is ready** rather than dropped.
  - source: `https://learn.microsoft.com/azure/durable-task/common/durable-task-instance-management#send-events-to-instances`
- Microsoft proactive-messaging docs still describe `continueConversation` + cached conversation reference as the supported proactive turn pattern, and Teams/Bot docs still describe inline message update via cached activity id as a supported pattern.
  - sources:
    - `https://learn.microsoft.com/azure/bot-service/bot-builder-howto-proactive-message?view=azure-bot-service-4.0#about-the-proactive-sample`
    - `https://learn.microsoft.com/microsoftteams/platform/bots/build-conversational-capability#send-and-receive-messages`
- GitHub MCP code search against upstream Azure Durable extension did **not** surface a clear documented engine limitation matching this exact “visible reply -> same-correlation re-entry -> queued follower never drains” shape.

Current conclusion:

- This is **not currently proven** to be a documented Durable Functions or Bot Framework platform limitation.
- The strongest live evidence still points at an application/runtime lifecycle seam in HelkinSwarm, now best represented by `#568` and the older related clue in `#559`.
- Therefore this should **not yet** be declared a permanent platform exception.

### Loop-breaker rule for this seam

Do **not** keep sending ordinary ignition runs back to stale `#567` wording after the same evidence repeats.

From this point:

1. treat `#568` as the freshest executable child, **not** `#567`
2. use `#567` as the parent evidence bundle for the earlier stale-ack/send-reply hypotheses already tested
3. if one more shipped `#568` attempt still ends with the same live signature:
   - visible leader reply
   - no pending ack
   - leader correlation later re-enters prompt / LLM work
   - exact-target follower still only shows `BufferedIngressQueued` / `DevLoopRelayPush`
   - no `BufferedIngressDequeued` / `LivingSessionNewMessageDrained` / `ReplySent`
   then **stop** treating this seam as the default next daily shipping target
4. at that point, re-bucket this seam as a **constitutional exception / research rail** and resume ordinary backlog execution with `#485` until either:
   - upstream platform evidence appears,
   - a materially new repo-grounded hypothesis emerges,
   - or a different repro path breaks the loop

### Loop-breaker result — triggered on 2026-04-05

This threshold has now been met in practice.

Evidence:

- `577993e` (`fix(#568): move memory write out of reply path`) still failed live:
  - follower remained queued
  - exact full-correlation leader bundle still showed same-correlation `PromptBuilt` / `LlmCallStarted` / `LlmCallCompleted` after `ReplySent`
- `70308e7` (`fix(#568): suppress post-reply session reentry`) also failed live:
  - leader surfaced the stale interruption warning instead of a clean final answer
  - exact-target follower still remained queued
  - runtime later showed `activeTurns: 0`, so the seam changed shape again without clearing

Decision now encoded here:

- `#568` remains open as a **research / exception rail**
- it is **not** the default next daily shipping target anymore
- ordinary backlog execution resumes with `#485`
- future work should return to `#568` only when there is:
  - upstream/platform evidence,
  - a materially new repo-grounded hypothesis,
  - or a fresh repro that breaks the current loop

### Constitutional gate execution rule

When the constitutional gate is active, the default next-work bias is now:

1. do **not** keep targeting `#568` by default — it is quarantined on the exception rail
2. resume ordinary backlog execution with `#485`
3. revisit `#568` only with materially new evidence/hypothesis

Do **not** fall back to stale earlier guidance that still points at `#554`, `#555`, or the already-cleared early child slices.

---

## Zone A — Regular backlog once the gate stops blocking

This is the ordinary backlog surface that should resume **as soon as** the current constitutional seam is cleared, narrowed enough, or explicitly re-bucketed so it no longer blocks downstream work.

### Current live Zone A

| Order | Issue | Lane | Confidence | Why it is here now |
|---|---|---|---|---|
| 1 | `#485` | Trust / UX honesty parent | C3/C4-partial | The broad follow-up proof-routing concern remains open, but the live thread has now narrowed to a smaller executable child. |
| 1a | `#565` | Current deepest Zone A blocker | C3/C4-failed | The remaining active trust seam is now the quoted Outlook proof follow-up that still collapses to `helkin_skill_search` discovery output instead of executing the safe mailbox proof path. |

### Recently cleared Zone A items

These are no longer part of active competition:

- `#479` — closed
- `#480` — closed
- `#484` — closed

### Zone A execution rule

Once the constitutional gate is no longer the honest blocker, the default next target becomes:

1. `#565`
2. then collapse/close or honestly re-bucket `#485`

If `#565` is closed, superseded, or explicitly re-bucketed, reassess whether `#485` still has a broader remaining seam. If not, promote the strongest ready Zone B candidate.

---

## Zone B — Next pivot after Trust Recovery

| Order | Issue | Lane | Confidence | Why it is here now |
|---|---|---|---|---|
| 1 | `#501` | Provider abstraction / runtime readiness | C2 | Strongest next non-constitutional pivot once the living-session seam and trust-recovery follow-up are no longer the honest front. |
| 2 | `#462` | Microsoft / M365 strategic capability | C1 | Strategic epic, but not the next default execution target. |
| 3 | `#472` | Microsoft / M365 strategic capability | C1 | Same. |
| 4 | `#476` | Runtime readiness / M365 | C1 | Best likely narrow implementation slice in that family later. |

---

## Retirement / handoff rule for this control surface

This file should **stop acting as a constitutional override** for ordinary runs when all of the following are true:

- the freshest live seam (`#568`, or whatever supersedes it) is closed or honestly re-bucketed,
- `#566` / `#556` no longer represent an active blocker for same-instance living-session continuity,
- and `#520` / `#516` / `#498` are either closed or narrow enough that downstream backlog work is no longer explicitly blocked by them.

### At that moment, the default handoff is:

1. return to ordinary DevLoop / regular backlog behavior
2. take `#485` next
3. then promote `#501` if no fresher Zone A blocker replaces it

That is the explicit escape hatch. Future runs should **not** keep re-entering a stale `#556` / `#568` loop once the live blocker chain has moved or been honestly quarantined.

### Handoff status — active as of 2026-04-05 evening

The handoff is now considered **active** for ordinary backlog runs.

Reason:

- `#568` has been explicitly re-bucketed to the exception rail after repeated shipped C4 failures
- the seam is still open, but it no longer deserves to block routine backlog reduction by default
- future runs should therefore switch back to the regular backlog loop and take `#485` next unless new evidence re-activates this campaign

---

## Current recommendation encoded here

### Honest short version

- **No**, the constitutional architecture questions are not magically solved.
- **Yes**, the loop was stale enough that this seam has now been explicitly stepped over.
- `#568` remains open, but it is quarantined on the research / exception rail rather than competing as the default daily target.
- Ordinary backlog work should now resume with:
  - `#565`
  - then `#485` only if a broader parent seam still honestly remains
  - then `#501`

### Trust surface refresh — 2026-04-05 late evening

Live issue state narrowed again after the `#485` / `#564` validation chain:

- `#564` is closed
- `#485` remains open as the broader parent trust issue
- the current executable child is now `#565`

Future runs should therefore work `#565` first instead of treating `#485` as the immediate implementation target.

### Trust validation blocker note — 2026-04-05 late night

The selector still points at `#565` as the active trust-recovery child, but closure-grade C4 on `#565` is **not always obtainable on demand** while the older living-session seam is still polluting the runtime.

Fresh evidence from the latest shipped `#565` repair cluster:

- one clean C4 run still failed on the real Outlook quoted-proof path (`corr:2b0913cc`) and showed the turn collapsing to `helkin_skill_search`
- later post-fix probes were no longer clean trust tests because ordinary setup turns themselves were intermittently interrupted with:
  - `⚠️ This turn was interrupted before a final reply could be delivered. Please resend it if you still need a response.`
- runtime health at the same time continued to show the old lingering living-session correlation from the existing constitutional seam:
  - `2b0913cc-e40b-4a55-82cb-86133167d09e`
  - stage `build-prompt`

Operational meaning:

- `#565` remains the correct Zone A child for trust routing work
- but when this runtime-interruption pattern is present, **do not** mistake the noisy setup-turn failures for closure evidence about `#565`
- in that state, the existing `#568` seam has temporarily reasserted itself as a validation blocker even though it remains quarantined as day-to-day implementation work

Default behavior from here:

1. still prefer `#565` for repo-side trust-routing improvements
2. but if clean C4 is blocked by the stale living-session interference pattern above, record that honestly on `#565`
3. and treat `#568` as the active blocker rail for validation, not as a fresh re-ranking of the whole backlog

### Loop protection note — 2026-04-05 evening refresh

This file must now actively prevent a repeat of the last two-day loop.

What changed since the earlier refresh:

- live repo + runtime evidence now shows `#568` is the freshest child, not `#567`
- first-party Microsoft docs review did **not** uncover a clear platform limitation that would explain the seam as expected behavior
- repeated shipped attempts on `#567` narrowed the problem, but did not clear the live bar
- the additional `#568` loop-breaker probe has now been spent and failed
- future runs should therefore treat `#568` as quarantined exception work and hand back to `#485`

### Refresh note — 2026-04-05

This refresh explicitly corrects the previous stale state:

- removes `#554` and `#555` from the active constitutional front
- removes `#479` and `#484` from active Zone A competition
- recognizes that `#556` is now a **mitigated-but-still-open architecture parent**, not the unchanged black-hole symptom from 2026-04-04
- supersedes the older `#567`-is-deepest wording with `#568` as the freshest child
- encodes the explicit handoff back to the ordinary backlog once this narrow seam is cleared
