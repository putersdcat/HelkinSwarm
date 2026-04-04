# Issue `#556` Research Pass — 2026-04-04

This document captures a research-first pass on the current deepest constitutional blocker:

- `#556` — **Raised `NewMessage` events are not later drained when sent to an active-processing living overseer**

The goal of this pass was to avoid another blind guess-and-test cycle and instead re-ground the problem in:
- the current HelkinSwarm codebase
- official Microsoft documentation
- public Azure Durable Functions bug history and sample guidance

---

## Executive summary

### Short answer

The evidence does **not** support the lazy explanation that Durable simply drops external events raised before `waitForExternalEvent(...)` is reached.

Official Microsoft guidance says the opposite:
- raised external events are intended to be buffered if the orchestration is not yet waiting on that event name
- the event is then meant to be delivered when the orchestration later calls `waitForExternalEvent(...)`

So the current `#556` failure is more likely to be one of these:

1. **wrong-instance targeting during active processing**
2. **a real Durable/runtime edge around repeated same-name waits / event buffering in this orchestration shape**
3. **a smaller observability gap masking partial execution**

The first two are more plausible than the third.

### Practical conclusion

I do **not** yet think this proves the overall living-session design is impossible.

But I also do **not** think the next move should be another optimistic micro-patch.

The next implementation pass should treat `#556` as a serious runtime-contract question and add proof-grade validation around:
- which instance was targeted
- what the instance runtime status was at raise time
- whether the event was ever observed as buffered/drained
- whether a reply path was attempted at all

---

## Repo-grounded findings

## 1. The runtime currently relies on delayed external-event buffering during active processing

In `src/orchestrator/overseer.ts`:
- the orchestrator processes a turn via `processTurn(...)`
- **only after that returns** does it open the ingress window and create:
  - `waitForExternalEvent('NewMessage')`
  - `waitForExternalEvent('HookFired')`

Relevant code:
- `src/orchestrator/overseer.ts:107` — ingress-window open
- `src/orchestrator/overseer.ts:115` — `waitForExternalEvent('NewMessage')`

This means the active-processing overlap path depends on Durable buffering a `NewMessage` event that arrives **before** the orchestration reaches that later wait.

That architecture is legal **if** Durable behaves as documented.

---

## 2. Official Microsoft docs say pre-wait external events should buffer

### Durable external events docs

Microsoft Learn states:
- when an event is raised, if the instance isn't yet waiting on that event name, the event is added to an internal buffer/queue
- if the orchestration later begins listening for that event name, it should check that queue and consume the event

Relevant sources read:
- `https://learn.microsoft.com/azure/durable-task/common/durable-task-external-events`
- JS API docs for `DurableClient.raiseEvent(...)`
- JS API docs for `DurableOrchestrationContext.waitForExternalEvent(...)`

Key implications:
- `#556` is **not** explained by a simple “you must already be waiting or the event is lost” rule
- HelkinSwarm’s current design is relying on documented Durable behavior, not an obviously invalid assumption

Important caveat from the same docs:
- if there is **no running instance** with that instance ID, the raised event is discarded / has no effect
- the caller gets enqueue-level success, not a semantic guarantee that the target later drained the event

That caveat keeps **wrong-instance / race-to-non-running-target** very much alive as a hypothesis.

---

## 3. `devloop/new-message` does not prove semantic delivery — only enqueue success

In `src/functions/devLoopRelay.ts`:
- `devloop/new-message` resolves a target instance
- builds a `NewMessageEvent`
- calls `await client.raiseEvent(resolvedInstanceId, 'NewMessage', event)`
- if no exception is thrown, it returns success and tracks:
  - `deliveredToOverseer: true`

Relevant code:
- `src/functions/devLoopRelay.ts` — route `devloop/new-message`
- success here means **the raise call did not throw**
- it does **not** mean:
  - the target instance was the correct one
  - the event was later drained
  - the turn was executed
  - a reply was attempted

So the current helper overstates what it has proven.

This matches `#556` exactly.

---

## 4. Active-processing delivery uses weaker instance-resolution heuristics than the safe `awaiting-ingress` path

### Safe window path
The already-proven `awaiting-ingress` path is better grounded because stage docs include a concrete `instanceId`.

Relevant code:
- `src/orchestrator/ingressWindowStageActivity.ts:44`
  - `recordOrchestratorStage(..., 'awaiting-ingress', ..., input.instanceId)`
- `src/orchestrator/activeOverseerInstance.ts:70-76`
  - stage-bound instance IDs are preferred when available

### Active-processing path
During active processing, stage records frequently exist **without** a bound `instanceId`.

Example:
- `src/orchestrator/buildPromptActivity.ts:279`
  - `recordOrchestratorStage(correlationId, 'build-prompt', input.state.userId);`
  - no instance ID supplied

Because of that, `resolveDeliverableOverseerInstanceId(...)` must often fall back to less exact logic:
- first guard state if it points to an active instance
- otherwise newest active overseer instance

Relevant code:
- `src/orchestrator/activeOverseerInstance.ts`
- `src/orchestrator/mindSessionGuard.ts`

### Why this matters
This does **not** prove misrouting happened in `#556`, but it does mean:
- active-processing injection is resolved with weaker targeting evidence than the safe-window path
- if multiple running overseers exist or guard state is stale/ambiguous, the event could be sent to the wrong running instance

This keeps **wrong-instance selection** as a serious hypothesis.

---

## 5. The reply path is probably not the primary bug

In `src/orchestrator/sendReplyActivity.ts`:
- if no pending ack exists, it simply sends a new proactive message
- if the incoming event omitted a `conversationReference`, it falls back to the stored conversation reference for the user
- if proactive send fails, it tracks `ReplySent` with `success: false` and throws

Relevant code:
- `src/orchestrator/sendReplyActivity.ts`
- `src/bot/conversationStore.ts`

For a `devloop/new-message` follower:
- there is no ack dependency required for a visible final message
- if the follower turn actually ran, we would expect either:
  - a visible Teams reply
  - or a `ReplySent` failure trace on the same correlation

The live evidence in `#556` showed **neither**.

That makes “reply plumbing bug” much less likely than “turn never executed / event never drained.”

---

## 6. Trace invisibility alone is not a sufficient explanation

HelkinSwarm trace trees are in-memory and can miss data across restarts/process boundaries:
- `src/observability/sessionTracer.ts`

So a missing trace tree is not conclusive by itself.

However, `#556` was not just a trace miss:
- no `LivingSessionNewMessageDrained`
- no `ReplySent`
- no visible Teams reply

So a pure observability miss does **not** explain the full symptom set.

At most, observability gaps could be hiding partial execution details.

---

## Outside evidence from Azure Durable bug history

## 1. There is real bug history around repeated `WaitForExternalEvent` behavior

A relevant issue in the Azure Durable Functions extension repo:
- `Azure/azure-functions-durable-extension#2430`
  - **Raised event is not delivered if waited for the 2nd time**

The scenario is not identical to HelkinSwarm, but it is uncomfortably adjacent:
- repeated waits on the same event name
- buffered event expectations
- event delivery depending on order/cancellation behavior

This matters because HelkinSwarm is also using repeated same-name waits across a long-lived orchestration loop:
- `waitForExternalEvent('NewMessage')`
- repeatedly across turns

## 2. Another issue shows event-consumption edge cases with cancelled waiters

Also relevant:
- `Azure/azure-functions-durable-extension#3255`
  - cancelled `WaitForExternalEvent` consuming events unexpectedly in isolated worker

Again, not the same stack as HelkinSwarm, but it weakens confidence in a naïve “external event buffering always behaves exactly as intended in every orchestration shape” assumption.

### What this does **not** prove
It does **not** prove that `#556` is a Durable platform bug.

### What it **does** prove
It proves the event system is subtle enough that HelkinSwarm should stop treating it as infallible black magic.

---

## Ranked hypotheses

## Hypothesis 1 — wrong running instance selected during active-processing delivery

### Why it is plausible
- active-processing stage docs often lack `instanceId`
- deliverable resolution falls back to guard/newest-running heuristics
- the helper returns success once `raiseEvent(...)` enqueues, not once the right instance drains it

### Why it fits the symptom
- event appears “delivered” from the helper perspective
- follower correlation later shows no drain/reply
- if a different running instance was targeted, the expected correlation would never surface on the leader’s path

### Current confidence
**Medium-High**

---

## Hypothesis 2 — Durable event buffering in this exact loop shape is unreliable / edge-casey

### Why it is plausible
- official docs say buffering should work
- but Azure issue history shows repeated same-name waits can have surprising behavior
- HelkinSwarm is depending on an event raised during active processing being consumed by a later waiter with the same event name

### Why it fits the symptom
- enqueue succeeds
- later drain never occurs
- no reply is attempted

### Current confidence
**Medium**

---

## Hypothesis 3 — the turn ran partially, but correlation/trace attribution hid it

### Why it is plausible
- trace trees are in-memory
- some repo instrumentation is best-effort

### Why it is weaker
- no visible Teams reply was observed
- no `ReplySent` failure either
- the lack of user-visible output makes a pure trace-only explanation too weak

### Current confidence
**Low-Medium**

---

## Hypothesis 4 — reply/send plumbing failed before visible output

### Why it is plausible
- proactive messaging is always a possible failure surface

### Why it is weaker
- `sendReplyActivity` would normally emit `ReplySent` success or failure on the follower correlation
- the helper path does not depend on ack replacement to show a fresh message

### Current confidence
**Low**

---

## Hypothesis 5 — the overall living-session architecture must be rewritten around an explicit mailbox queue

### Why it is plausible
- if hypotheses 1 and 2 cannot be resolved cleanly, then relying on external-event buffering during active processing may simply be too opaque/risky

### Current confidence
**Not first assumption, but viable fallback**

This should be treated as the backup conclusion, not the starting conclusion.

---

## What this research changes about the next implementation pass

## 1. Do not assume the next fix is “just open the wait earlier”

That might work.

But before changing orchestration structure, the next pass should first prove:
- whether the correct instance was targeted
- whether the instance was still running at the moment of raise
- whether the event later appeared in any way on that exact instance

Otherwise we risk solving the wrong problem.

## 2. The next proof bundle needs stronger delivery semantics than `deliveredToOverseer: true`

The current helper should not be treated as proof of actual semantic delivery.

Future proof should distinguish at least:
- `instanceResolved`
- `instanceStatusAtRaise`
- `raiseEventEnqueued`
- `eventDrained`
- `sessionExecuted`
- `replyAttempted`
- `replyVisible`

## 3. The next implementation pass should prefer one of two design directions

### Preferred first attempt — keep the architecture, tighten proof and targeting
Try to make the current architecture work by:
- proving target-instance correctness during active processing
- binding active-processing stages to `instanceId` where practical
- making the replay/drain path more observable
- then retesting `#556`

### Fallback if that fails — explicit mailbox model
If active-processing injection still cannot be made reliable/provable, move to a more explicit design:
- write follower messages to a per-user durable mailbox/queue
- have the overseer drain from that mailbox at a deterministic point
- stop depending on implicit pre-wait external-event buffering for the critical path

---

## Recommended next validation steps before code changes

1. **Strengthen active-processing targeting evidence**
   - prove exactly which instance `resolveDeliverableOverseerInstanceId(...)` returns during active processing
   - capture whether stage docs, guard state, and status enumeration all agree on that instance

2. **Prove runtime status at raise time**
   - log/query the target instance runtime status immediately before and after the raise
   - distinguish `Running` vs quiescent/dedup-hold vs race-to-completion

3. **Add proof for drain semantics, not just enqueue semantics**
   - ensure the instrumentation makes it impossible to confuse:
     - enqueue success
     - later drain
     - later reply

4. **Run a narrower reproducer specifically for “raise during active sub-orchestrator work, drain after wait is created”**
   - this is the exact contract HelkinSwarm is relying on
   - it should be proven directly, not assumed from generic docs

5. **Only if the above stays inconclusive, redesign around an explicit mailbox queue**

---

## Current recommendation

### My best current call

Treat `#556` as **likely still fixable within the current overall architecture**, but only if the next pass is more disciplined than the last one.

### What I would do next

1. keep the current living-session design as the working hypothesis
2. add stronger active-processing instance-binding / proof instrumentation
3. retest `#556`
4. if that still fails, switch from implicit event buffering to an explicit mailbox/drain model

That is the most honest “go hard to deliver” path without pretending the runtime is simpler than it is.
