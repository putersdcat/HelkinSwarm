# Remaining Work Assessment — 2026-04-05 Refresh

This refresh supersedes the 2026-04-04 assessment where it conflicts with current trunk and live issue state.

The short version is:

- the constitutional gate is **still real**
- but the docs were **too stale and too sticky**
- the live blocker has narrowed from broad `#556` to the current child seam `#567`
- and the handoff back to the ordinary backlog is now clear once that narrow chain is resolved or honestly re-bucketed

---

## Executive summary

### Where we really are now

The Living Mind constitutional gate is **not fully cleared**.

But it is also no longer honest to describe the repo as if it were still sitting at the old 2026-04-04 failure shape.

Since then, trunk now contains all of the following repo-grounded changes:

- explicit buffered follower storage in `src/orchestrator/bufferedIngressActivity.ts`
- active-processing buffering in `src/functions/devLoopRelay.ts`
- active-processing Teams buffering in `src/bot/HelkinSwarmBot.ts`
- same-instance drain attempts in `src/orchestrator/overseer.ts`
- automatic stale buffered-follower rescue in `src/functions/bufferedIngressReplayTimer.ts`
- owner-side buffered-ingress inspection/replay seams in `src/functions/devLoopBufferedIngress.ts`

So the active question is no longer:

> “Do active-processing followers just vanish with no recovery path?”

It is now:

> “Why does the original living overseer still fail to perform ordinary same-instance dequeue/drain, even though buffering, targeting, and rescue paths now exist?”

### Practical conclusion

We are **closer than the previous assessment said**, but **not yet past the constitutional gate**.

The good news:

- the user-facing black-hole symptom is no longer the full truth
- automatic recovery paths exist and are live-proven in issue discussion under `#556`
- the active front has narrowed to a very specific reply/ack-stage starvation seam

The bad news:

- the ordinary same-instance drain path is still not honestly proven
- the gate therefore still remains active
- and the current deepest executable blocker is now `#567`, not the older broader wording in `#556`

---

## What was stale in the previous assessment

The earlier document is now wrong or incomplete on several important points.

### Issue-state drift

These issues are now **closed** and should no longer be treated as active fronts:

- `#554`
- `#555`
- `#479`
- `#484`

### `#556` framing drift

The old assessment treated `#556` as the unchanged deepest blocker.

That is no longer precise enough.

`#556` is still open, but it is now an **architecture parent** with meaningful mitigation already shipped:

- buffered follower ingress exists
- replay rescue exists
- user-visible follower replies can be recovered

The newest live failure mode has narrowed through:

- `#566`
- and then `#567`

So if a future run keeps blindly selecting `#556` as though nothing changed, it will re-enter a stale loop.

---

## What the repo now proves

### 1. Active-processing buffering is real code, not just theory

Repo-grounded evidence:

- `src/orchestrator/bufferedIngressActivity.ts`
  - persists buffered follower docs
  - supports targeted dequeue / claim
- `src/functions/devLoopRelay.ts`
  - `devloop/new-message` can choose `buffered-active-processing`
- `src/bot/HelkinSwarmBot.ts`
  - direct Teams overlap can queue buffered followers against the active instance
- `src/orchestrator/overseer.ts`
  - checks buffered ingress before and during the ingress window
  - waits on `BufferedIngressQueued`

### 2. The new activity is actually wired

`src/functions/index.ts` imports:

- `../orchestrator/bufferedIngressActivity.js`
- `./bufferedIngressReplayTimer.js`
- `./devLoopBufferedIngress.js`

So this is not just dead code sitting in the repo unwired.

### 3. Automatic rescue now exists for stranded followers

`src/functions/bufferedIngressReplayTimer.ts`:

- lists stale queued buffered followers
- starts a replay overseer when needed
- records `BufferedIngressFallbackReplayed`

This means the old user-facing “silent black hole forever” description is no longer the full current truth.

### 4. Owner-side inspection/replay seams also exist

`src/functions/devLoopBufferedIngress.ts` now exposes:

- buffered-ingress listing
- manual replay
- force-start-new replay

So the platform now has both automatic and operator-side rescue surfaces.

---

## What still remains open

### 1. `#567` — current deepest executable blocker

**Title:** Exact-target follower no longer replays, but stays queued behind a long-lived `send-reply` stage and can surface stale-ack interruption on the leader turn

This is the freshest honest next target.

Why:

- issue `#567` is open
- its issue thread says the latest live failure no longer looks like wrong-instance replay rescue
- the follower remains queued on the original instance
- runtime diagnostics still show the original instance holding an active `send-reply` stage
- the leader can surface the warning text from `src/bot/staleAckRecovery.ts`

Relevant repo surfaces:

- `src/orchestrator/sendReplyActivity.ts`
  - reply update/send lifecycle
  - pending-ack clearing
- `src/bot/staleAckRecovery.ts`
  - emits the visible interruption warning

### 2. `#566` — still open parent, but no longer the freshest slice

`#566` remains open and still matters.

But its main optimistic wrong-instance hypothesis has already been narrowed by live proof.

So it should be treated as the parent seam immediately above `#567`, not the default next execution target.

### 3. `#556` — still open honestly, but materially narrower

The remaining open claim in `#556` is now much more specific:

- ordinary same-instance dequeue/drain is still not proven
- replay/rescue still does too much of the real user-facing work

That means `#556` is still active, but not in the same way the older assessment described.

### 4. `#520`, `#516`, `#498` — still-open parent chain

These remain real because the runtime still does **not** honestly prove the full end-state:

- a truly healthy event-draining living session
- a fully proven hard single-session invariant
- closure of the first-wave constitutional parent

But those parents are no longer the right default execution target while `#567` is the concrete blocker.

---

## What this means for the control surface

### Are we nearly done with the constitutional gate?

**Closer, yes. Done, no.**

I would describe the current state like this:

- we are in the **late narrow-seam phase**, not the broad-foundation phase
- the docs should no longer force repeated returns to stale parent wording
- but the ordinary backlog should not fully take over until the `#567` → `#566` → `#556` chain is resolved or honestly re-bucketed as non-blocking

### Should 09 still govern the next run?

**Yes, but only in its refreshed form.**

The old version over-bound the loop.

The refreshed version should govern like this:

1. take `#567` next
2. then collapse the remaining parent chain (`#566`, `#556`, `#520`, `#516`, `#498`)
3. then return to the ordinary backlog immediately

### What is the ordinary backlog handoff after that?

Once the constitutional seam stops being the honest blocker:

1. `#485`
2. then `#501`

That is the concrete post-gate path back to normal DevLoop work.

---

## Bottom line

The earlier assessment was directionally right, but it is now status-stale.

Today’s honest state is:

- the constitutional gate is still active
- the work has narrowed much further than the previous draft said
- the active blocker is now `#567`
- `#556` is still open, but now as a parent architecture issue with mitigations already shipped
- once the current narrow seam is cleared or honestly re-bucketed, the control surface should hand us back to the regular backlog rather than dragging us back into the old constitutional wording again
