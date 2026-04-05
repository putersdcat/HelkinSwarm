# Issue `#556` Research Pass — 2026-04-05 Refresh

This file now supersedes the earlier 2026-04-04 framing where it conflicts with current trunk and live issue state.

The original research about Durable external-event buffering is still historically useful, but it is **no longer the current repo reality**.

The repo no longer relies only on “raise `NewMessage` now and hope a later `waitForExternalEvent(...)` drains it.”

It now has explicit buffered-ingress machinery, targeted claim/dequeue attempts, and automatic replay rescue.

---

## Executive summary

### What changed since the original research pass

The central premise of the earlier document is now outdated.

Current repo state shows:

- `src/orchestrator/bufferedIngressActivity.ts`
  - durable buffered follower storage
  - targeted dequeue / claim behavior
- `src/orchestrator/overseer.ts`
  - immediate buffered-ingress check after turn completion
  - `BufferedIngressQueued` wake path
  - targeted dequeue / claim using `context.df.instanceId`
- `src/functions/devLoopRelay.ts`
  - `buffered-active-processing` mode for owner-side follower injection
- `src/bot/HelkinSwarmBot.ts`
  - buffered routing for direct Teams overlap when active-processing evidence exists
- `src/functions/bufferedIngressReplayTimer.ts`
  - automatic stale buffered-follower replay rescue
- `src/functions/devLoopBufferedIngress.ts`
  - owner-only buffered-ingress inspection and replay seams

So the runtime is no longer simply depending on blind pre-wait external-event buffering for this class of overlap.

### What is now honestly true

`#556` remains open, but not for the same reason the original research pass emphasized.

The current honest state is:

- buffered followers are now definitely reaching durable storage
- user-visible recovery paths now exist and are live-proven
- the remaining open seam is that the **original living overseer still is not honestly proven to dequeue/drain the follower itself**

That remaining seam has already narrowed further into:

- `#566`
- then `#567`

---

## Repo-grounded findings

### 1. Buffered ingress is now the real active-processing mechanism

`src/orchestrator/bufferedIngressActivity.ts` now defines the buffered follower document flow:

- queue buffered follower docs
- mark them `queued`, `dequeued`, or `replayed`
- prefer `targetInstanceId` when selecting a doc
- convert docs back into `NewMessageEvent` payloads

That is materially different from the earlier “maybe Durable is dropping the event” framing.

### 2. The living overseer explicitly tries to drain buffered followers

`src/orchestrator/overseer.ts` now:

- dequeues buffered followers immediately after `processTurn(...)`
- opens a `BufferedIngressQueued` wait path during the ingress window
- claims buffered followers by exact `docId` when signaled
- passes `context.df.instanceId` into buffered claim/dequeue paths

So I do **not** see this wired as a purely theoretical attempt. The code is actively trying to make the original instance drain the follower.

### 3. Cross-request ingress no longer blindly uses the old direct external-event path

`src/functions/devLoopRelay.ts` now distinguishes:

- `external-event`
- `buffered-active-processing`

And it chooses the buffered path when active-processing evidence says the leader is still mid-turn.

`src/bot/HelkinSwarmBot.ts` also now queues buffered followers against the active instance for the corresponding direct Teams path.

### 4. The user-facing symptom is no longer unrecoverable

`src/functions/bufferedIngressReplayTimer.ts` now automatically rescues stale queued followers by starting a replay overseer and recording `BufferedIngressFallbackReplayed`.

`src/functions/devLoopBufferedIngress.ts` also provides owner-only manual replay / force-start-new seams.

So the older blanket statement:

> “the follower disappears without recovery”

is no longer accurate as current-state guidance.

---

## What the live issue trail now proves

Based on the current `#556` and child issue threads:

### Proven now

- active-processing follower injection can choose `buffered-active-processing`
- buffered followers are durably recorded
- replay rescue can produce a visible final follower reply
- the old pure black-hole symptom has been materially reduced

### Still not proven

- the original targeted living instance emits `BufferedIngressDequeued`
- the original targeted living instance emits `LivingSessionNewMessageDrained`
- the follower reply arrives through ordinary same-instance drain rather than rescue
- the newest proof path is free of leader-side stale-ack interruption

### Latest narrowed state

The freshest live blocker is now `#567`:

- replay rescue no longer dominates that exact proof path
- the buffered follower stays `queued`
- runtime diagnostics still show the original instance holding `send-reply`
- Teams can surface the warning text from `src/bot/staleAckRecovery.ts`

So the remaining question is now less about wrong-instance targeting and more about reply/ack-stage starvation or post-reply lifecycle progression.

---

## Updated hypothesis ranking

### Hypothesis 1 — reply/ack lifecycle starvation on the original living instance

This is now the strongest active hypothesis.

Why:

- `#567` explicitly reports the original instance still sitting at `send-reply`
- the leader can surface the stale-ack interruption warning from `src/bot/staleAckRecovery.ts`
- the follower remains queued instead of draining

### Hypothesis 2 — the original instance never truly progresses into a serviced ingress window after reply work

Still plausible.

The issue trail now points more toward lifecycle progression after reply delivery than toward initial routing alone.

### Hypothesis 3 — deeper orchestrator loop / waiting semantics still interfere with the ordinary drain path

Still possible, but no longer the first explanation.

### Hypothesis 4 — wrong-instance targeting alone caused the problem

This was the optimistic explanation.

The latest `#566` proof materially weakens it, because the follower was targeted at the exact original instance and still was not drained there.

---

## Current recommendation

### What the next implementation pass should target

Treat `#567` as the immediate next executable seam.

That means inspecting:

- `src/orchestrator/sendReplyActivity.ts`
- `src/bot/staleAckRecovery.ts`
- the post-reply lifecycle in `src/orchestrator/overseer.ts`

### What not to do

Do **not** keep working from the stale assumption that `#556` is still mainly about whether Durable buffers pre-wait external events.

That was a useful research starting point.
It is no longer the current blocking truth.

### Honest bottom line

`#556` is still open.

But the current state is now:

- **mitigated enough that users can be rescued**,
- **narrow enough that the active blocker is really `#567`**,
- and **specific enough that the control surface should stop reselecting stale parent wording as though nothing changed**.
