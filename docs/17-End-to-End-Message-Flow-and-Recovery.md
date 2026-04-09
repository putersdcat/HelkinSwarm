# End-to-End Message Flow and Recovery

This document is a **working map** of the live Teams message path for HelkinSwarm, written to be fast for an LLM or human to reload before touching the core execution flow.

It focuses on the path implicated by the 2026-04-09 screenshot cluster where:

- a burst of messages produced early stale-ack warning edits
- some of those turns later produced real replies anyway
- the user-visible warning therefore did not faithfully describe backend reality

Related issues:

- `#605` — stale-ack warning appears first, delayed real replies arrive later
- `#606` — timestamps in footers and recovery warnings
- `#602` — broader post-`#494` degradation breadcrumb
- `#494` — intended overlap / interruption architecture

## High-level flow

```text
Teams client
  -> Global router app (`src/router/routerFunction.ts`)
    -> User stamp `/api/messages` (`src/functions/messages.ts`)
      -> Bot Framework adapter (`src/bot/adapter.ts`)
        -> `HelkinSwarmBot.handleIncomingMessage()`
          -> send inline ack + persist pending ack doc
          -> raise / buffer into overseer living session
            -> `overseer` orchestrator
              -> `sessionOrchestrator`
                -> prompt / plan / llm / tools / follow-up
                -> `sendReplyActivity`
                  -> update ack in place or send fallback proactive reply
                  -> clear pending ack
                  -> clear orchestrator stage
```

## Source map by stage

### 1. Global router

File: `src/router/routerFunction.ts`

Responsibilities:

- validates Bot Framework JWT
- extracts `activity.from.aadObjectId`
- looks up the user stamp in `config/user-map.json`
- proxies the full Bot Framework activity body to the user stamp endpoint
- records shared message-path health start / accept / failure

Important consequence:

- router latency/failure is **part of the real message path** even though it lives outside the stamp

### 2. Stamp ingress HTTP trigger

File: `src/functions/messages.ts`

Responsibilities:

- receives the routed Bot Framework activity
- creates a `turnId` for message-path health tracking
- runs the adapter and bot handler
- returns `200` early after `EARLY_RESPONSE_MS` (14s) to avoid Teams retry storms
- lets the bot logic continue in the background if early return fired

Important consequence:

- the HTTP turn and the actual bot/orchestrator work can diverge in time
- this can make screenshot timing harder to reason about if you only look at HTTP acceptance

### 3. Bot adapter layer

File: `src/bot/adapter.ts`

Responsibilities:

- constructs the shared `CloudAdapter`
- runs Teams SSO middleware when configured
- records message-path global failures on unhandled bot turn errors

### 4. Bot inbound handler

File: `src/bot/HelkinSwarmBot.ts`

Primary path in `handleIncomingMessage()`:

1. dedup in-memory retry keys
2. save inbound correlation id
3. send immediate ack (`⌛ ... [corr:xxxx]`)
4. persist pending ack doc via `savePendingAckId()`
5. call `raiseToOverseer()`
6. depending on result, maybe replace ack with duplicate/queued/deferred notices

Important consequence:

- once the ack is persisted, later recovery code may edit that ack even if deeper work still exists elsewhere

### 5. Pending ack / outbound artifact storage

File: `src/bot/conversationStore.ts`

Relevant documents:

- `ack-{correlationId}` — pending ack doc
- `outbound-reply-{dedupKey}` — reply claim
- `outbound-session-execution-{dedupKey}` — replay-suppression claim

Important consequence:

- user-visible state is inferred from a mix of ack docs and outbound-artifact claims
- if those drift relative to actual durable execution, recovery heuristics can misread reality

### 6. Overseer orchestration

File: `src/orchestrator/overseer.ts`

Responsibilities:

- load persisted state
- process exactly one turn per instance
- optionally buffer / handoff followers to fresh overseers
- open an ingress window waiting for new events

Important consequence:

- stage docs and buffered-ingress events are part of the observable truth, but not the whole truth

### 7. Session orchestration

File: `src/orchestrator/sessionOrchestrator.ts`

Responsibilities:

- canonicalize input
- apply clarification / discovery / routing helpers
- build prompt
- plan
- call LLM
- run tools / follow-ups
- build telemetry footer
- call `sendReplyActivity`

Important consequence:

- reply text/telemetry can be fully composed before actual proactive delivery and ack cleanup complete

### 8. Proactive reply delivery

File: `src/orchestrator/sendReplyActivity.ts`

Responsibilities:

- claim reply artifact
- resolve conversation reference
- try to update the ack in place
- if ack update fails non-timeout, send a new message instead
- clear pending ack after delivery path completes
- clear orchestrator stage
- record `ReplySent` telemetry and message-path success

Important nuance:

- ack update timeout is treated specially to avoid duplicate sends
- visible delivery may already have happened even if later cleanup is slow or times out

### 9. Stale-ack recovery

File: `src/bot/staleAckRecovery.ts`

Current recovery condition:

- no active orchestrator stage for the correlation
- no reply artifact claim for the correlation

If both are absent, stale-ack recovery edits the original ack into a warning message.

Important consequence:

- this is a **heuristic inference**, not a guaranteed proof that the turn is truly dead
- if the stage/claim view is temporarily incomplete while real work still exists, the user can see a warning first and a real reply later

## Why the 2026-04-09 screenshot cluster matters

The reported pattern was:

1. lead turn gets a normal reply
2. follower turns get stale-ack warning edits
3. later, real replies for those follower turns still appear

That means at least one of these is true:

- stale-ack recovery is firing too aggressively
- stage / reply-claim visibility is incomplete at recovery time
- proactive delivery or cleanup timing is drifting relative to the recovery watchdog
- the end-to-end path is split across router + stamp + background execution in a way the current warning text does not acknowledge

## Timing details that explain misleading screenshots

### Stale-ack watchdog timing

Confirmed in source:

- `src/bot/staleAckRecovery.ts` sets `STALE_ACK_THRESHOLD_MS = 6 * 60 * 1000`
- `src/functions/staleAckRecoveryTimer.ts` runs on schedule `0 */5 * * * *` (every 5 minutes)

So a stale-ack warning is **not** expected to appear immediately after the original user message.
It appears later when the watchdog wakes up and decides the original ack doc is old enough.

### Teams edited-message timestamp behavior

The stale-ack path edits the **original ack message** in place rather than sending a new message.

Important consequence:

- Teams keeps showing the original message timestamp for the edited ack row
- so a warning that was edited in much later can still visually look like an `08:25` message in the chat transcript

That is why screenshot-only analysis can be very misleading unless the message also carries an explicit recovery timestamp.

## Current debugging anchors

### User-visible anchors

- ack text and warning edits in Teams
- telemetry footer correlation ids
- telemetry footer absolute timestamp field (added under `#606`)

### Runtime anchors

- `/api/health` from `src/functions/health.ts`
- router `/api/health` from `src/router/routerHealth.ts`
- pending ack snapshot from `conversationStore.ts`
- orchestrator stage snapshot from `orchestratorStageHealth.ts`
- message-path shared state from `messagePathHealth.ts`

## Intended investigation sequence for future work

1. trace one full burst through router -> stamp -> bot -> overseer -> sendReply -> staleAckRecovery
2. compare the exact timing of:
   - ack creation
   - stage transitions
   - reply claim creation
   - proactive send completion
   - pending ack clear
   - stale-ack recovery edit
3. identify why the warning can precede a later real reply
4. redesign the warning message/logic so it reflects reality rather than a misleading terminal-sounding failure

## Bottom line

The system is **not** simply “reply failed.”

The current code path allows a more complex state:

- the ack placeholder looks stale from the recovery heuristic
- but deeper execution may still be alive or may complete later

That is the core thing to keep in mind whenever touching this flow.