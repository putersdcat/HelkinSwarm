---
applyTo: "src/orchestrator/**,src/functions/**,host.json"
---

# Azure Durable Functions Infrastructure — Hard-Won Operational Knowledge
**Learned through production debugging. Every entry cost real hours.**

## Azure Storage Backend — The Source of All Pain

HelkinSwarm uses the **Azure Storage backend** for Durable Functions (not Netherite or MSSQL).
This has profound implications for orchestrator performance and correctness.

### The Fundamental Performance Model

Each `yield` in an orchestrator = **full history replay + Azure Queue poll + checkpoint**.
On the Azure Storage backend with `maxQueuePollingInterval: "00:00:02"`:
- **Best case**: ~2–5s per yield (activity completes quickly, queue poll picks it up fast)
- **Typical case**: ~5–10s per yield (activity takes a few seconds, then poll delay)
- **Worst case**: 30–60+ seconds per yield (out-of-order message with visibility delay)

**This means**: An orchestrator with 15 sequential yields will take 30–150 seconds minimum.
Batching activities and minimizing yields is NOT an optimization — it is **critical for usability**.

### Out-of-Order Messages (ReceivedOutOfOrderMessage)

**Root cause of multi-minute orchestrator hangs.**

The Azure Storage backend uses queue messages to communicate between activities and orchestrators.
When an activity completes, its result goes into a control queue. If the orchestrator's checkpoint
is not yet at the "episode" that expects this result, the message is classified as
`ReceivedOutOfOrderMessage` and returned to the queue with an exponentially growing visibility delay
(starting at 32ms but escalating to 30+ seconds).

**Symptoms**: Orchestrator stage health shows `stage: 'llm'` stuck for 60+ seconds even though
`llm.lastSuccessAt` shows the LLM call completed. The Durable runtime simply hasn't picked up
the completion message yet.

**Mitigation**: `extendedSessionsEnabled: true` in host.json keeps orchestrators in memory,
bypassing the queue-based message matching entirely for active sessions.

### Critical host.json Settings

```json
{
  "extensions": {
    "durableTask": {
      "maxQueuePollingInterval": "00:00:02",
      "extendedSessionsEnabled": true,
      "extendedSessionIdleTimeoutInSeconds": 60
    }
  }
}
```

| Setting | Default | Our Value | Why |
|---------|---------|-----------|-----|
| `maxQueuePollingInterval` | **30s** | **2s** | Default 30s means each yield waits up to 30s for poll. Catastrophic for multi-yield orchestrators. |
| `extendedSessionsEnabled` | `false` | `true` | Keeps orchestrators in memory, avoiding out-of-order message delays. Without this, sessions hang for 30–60+ seconds between activity completions. |
| `extendedSessionIdleTimeoutInSeconds` | 30 | 60 | How long to keep an idle orchestrator session alive in memory. 60s covers the ingress window. |

**WARNING**: Do NOT add other durableTask settings casually. Some settings that seem helpful
(like `maxConcurrentActivityFunctions` or `controlQueueBufferThreshold`) can cause worse
problems by starving queue workers or creating partition contention. The three settings above
are the verified safe set.

### Settings We Intentionally Do NOT Set

- `maxConcurrentOrchestratorFunctions` — default is fine, overriding can starve partition processing
- `controlQueueBufferThreshold` — can cause messages to be deferred unnecessarily
- `partitionCount` — changing after deployment can orphan existing instances
- `trackingStoreConnectionStringName` — we use default (same as main storage)

---

## The Drain Loop Problem (#598)

### What Happened
The original overseer had a `while(true)` drain loop: process a message → check for buffered
followers → process the next one → check again → etc. This worked fine locally but caused
**7+ minute follower pickup delays** in production.

### Why
Each time around the loop, the Durable history grows. On Azure Storage, every `yield` replays
ALL prior history events. After processing one turn (~15 yields), the second turn replays those
15 events before its own yields. The third replays 30 events. By turn 3–4, each yield takes
30+ seconds because it's replaying 45+ prior events plus the queue polling delay.

### The Fix: Handoff-to-Fresh-Overseer Pattern
Instead of looping, the overseer:
1. Processes exactly **one message** per instance
2. If a buffered follower exists, calls `handoffToFreshOverseerActivity` which starts a
   **new** overseer instance with a fresh `crypto.randomUUID()` instanceId
3. The new instance has zero history — its yields are fast
4. The old instance returns and completes cleanly

Key file: `src/orchestrator/handoffToFreshOverseerActivity.ts`

### Important: Handoff vs. Bot Ingress instanceId

| Path | instanceId Strategy | Why |
|------|---------------------|-----|
| Bot ingress (`raiseToOverseer`) | `buildOverseerDedupIdentity()` — deterministic from userId + text + 60s time bucket | Dedup: two identical messages within 60s get the same instanceId → 409 conflict = suppressed duplicate |
| Handoff activity | `overseer-${userId}-${crypto.randomUUID().slice(0, 12)}` | Must be unique: each follower gets a completely fresh instance with no history |

**NEVER** use `buildOverseerDedupIdentity()` for handoffs — it would cause
legitimate follower messages to be incorrectly dedup-suppressed.

---

## Activity Registration — The Silent Killer

**Every new activity file MUST be imported in `src/functions/index.ts`.**

Without the import, the activity handler is never registered with the Durable runtime.
`callActivity()` calls for it will **hang forever with no error**. The Azure Functions
runtime does not log a warning, does not throw, does not timeout — it just silently waits.

This was the root cause of a multi-hour production outage (#327): `planActivity.ts` was created
but never imported in `index.ts`.

### Checklist for any new activity:
1. ✅ Create `src/orchestrator/<name>Activity.ts` with `df.app.activity()`
2. ✅ Add `import './orchestrator/<name>Activity.js';` to `src/functions/index.ts`
3. ✅ Verify the import exists in `index.ts` before committing
4. ✅ Same applies for new orchestrations registered with `df.app.orchestration()`

---

## MindSessionGuard — Guard Release on All Exit Paths

The `MindSessionGuard` is a Durable entity that ensures exactly one active overseer per user.
It MUST be released on **every** exit path from the overseer:

| Exit Path | Guard Released? | How |
|-----------|-----------------|-----|
| Normal completion (reply sent) | Yes | Via ingress window timeout or handoff |
| Session timeout (5min) | Yes | `context.df.signalEntity(..., 'release', ...)` in timeout handler |
| Error/catch path | Yes | `context.df.signalEntity(..., 'release', ...)` in catch block |
| Handoff to fresh overseer | Yes | The fresh instance acquires its own guard via `signalMindSessionAcquire` |

**Failure to release**: The guard stays locked. No new overseers can start for that user.
The user gets spinner messages but no replies until the guard TTL expires (or manual intervention).

---

## Spinner Heartbeat and Reply Delivery Recovery

The overseer races the session sub-orchestrator against:
1. **Session timer** (5 min) — hard timeout
2. **Spinner timer** (8s initial, then 8s intervals, max 6 ticks) — UX feedback
3. **BufferedIngressQueued event** — follower messages during processing

On each spinner tick, `replyDeliveryRecoveryActivity` checks:
- Did `sendReplyActivity` already deliver a reply for this correlation? (via outbound artifact claim)
- Is the pending ack already cleared? (reply was ack'd by Teams)
- If both conditions met → the sub-orchestrator completed but its Durable completion message
  is stuck in out-of-order purgatory → terminate the sub-orchestrator and move on.

**MAX_SPINNER_TICKS = 6**. After 6 ticks (~56s), the spinner stops and the overseer
just waits for session completion or timeout. This prevents the spinner from creating
additional yields (each of which triggers a replay), making the problem worse.

---

## Sub-Orchestrator instanceId — Must Be Deterministic Per-Turn

Session sub-orchestrators use: `session-${overseerInstanceId}-${correlationId}`

This ensures:
- Each turn gets a **fresh** sub-orchestrator identity (no stale state from prior turns)
- The `purgeOrchestrationActivity` pre-purge can clean up any zombies from a prior run
- If the same overseer tries to process the same correlationId twice (replay), it gets
  the same sub-orchestrator instanceId → idempotent

**NEVER** use a static instanceId like `session-${overseerInstanceId}` across multiple turns.
Durable will attach later work to stale prior sub-orchestrator state.

---

## Post-Reply Batching

After the session sub-orchestrator completes and the reply is sent, the overseer needs to:
1. Store conversation memory
2. Save overseer state
3. Save chrono-continuity metadata

Originally these were 3 sequential `callActivity` calls = 15–30s of additional yield overhead.
Now batched into a single `postReplyBatchActivity` that runs all three in parallel.

Key file: `src/orchestrator/postReplyBatchActivity.ts`

---

## Durable Timer vs JS Timer

**NEVER use `setTimeout` or `setInterval` in orchestrator code.** JS timers are unreliable
in Azure Container Apps workers — the event loop may be busy or the timer may not fire.

**ALWAYS use Durable timers**: `context.df.createTimer(deadline)` + `Task.any([task, timer])`

This is how `withSubAgentTimeout` and `withLlmFollowUpTimeout` work in the session orchestrator.
The Durable timer fires reliably because it's managed by the Durable runtime, not the JS event loop.

---

## Container App Restart Behavior

When the Container App restarts (scaling event, deployment, crash):
- Existing orchestrator instances lose their in-memory state
- Azure Storage triggers a **partition lease reacquisition** — this takes 10–30 seconds
- During this window, the orchestrator appears stuck (no progress, no errors)
- After lease acquisition, the orchestrator replays from checkpoint and continues

This is an accepted limitation (#596). It manifests as the "first message after deploy" being slow.
Subsequent messages are fast because the container is warm and partitions are leased.

---

## Debugging Durable Functions Hangs

### Systematic diagnosis checklist:

1. **Check orchestrator stage health** via `/api/health` → `diagnostics.orchestrator.turns`
   - If `stage` is stuck and `ageMs` is growing, the orchestrator is hung
   - Compare `ageMs` with `llm.lastSuccessAt` — if LLM completed but stage didn't advance,
     the Durable runtime is stuck (not the LLM)

2. **Check container logs** for `ReceivedOutOfOrderMessage`
   ```
   az containerapp logs show --name <app> --resource-group <rg> --follow false --tail 100 --type console
   ```
   Search for: `out of order`, `ReceivedOutOfOrder`, `AbandoningMessage`, `visibility delay`

3. **Check `src/functions/index.ts`** — is the activity imported?
   If `callActivity('myNewActivity')` hangs forever, this is the first thing to check.

4. **Check MindSessionGuard** — is the guard stuck?
   If the user can't get any new overseers started, the guard may not have been released.

5. **Check pending acks** — are there stale pending acks?
   `diagnostics.messagePath.stalePendingAcks > 0` means a reply was sent but never confirmed.

---

## Key Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `SESSION_TIMEOUT_MS` | 300,000 (5 min) | overseer.ts | Hard timeout for session sub-orchestrator |
| `POST_REPLY_ACTIVITY_TIMEOUT_MS` | 15,000 | overseer.ts | Timeout for post-reply batch |
| `DEDUP_HOLD_MS` | 60,000 | overseer.ts | Keep instance Running to block retries |
| `INGRESS_BUFFER_POLL_MS` | 2,000 | overseer.ts | Poll interval for buffered messages |
| `SPINNER_INITIAL_DELAY_MS` | 8,000 | overseer.ts | Time before first spinner message |
| `SPINNER_INTERVAL_MS` | 8,000 | overseer.ts | Time between spinner updates |
| `MAX_SPINNER_TICKS` | 6 | overseer.ts | Max spinner heartbeats (prevents replay bloat) |
| `FOLLOWUP_DURABLE_TIMEOUT_MS` | 100,000 | sessionOrchestrator.ts | Timeout for LLM follow-up calls |
| `SUB_AGENT_DURABLE_TIMEOUT_MS` | 90,000 | sessionOrchestrator.ts | Timeout for sub-agent tool calls |

*We are the bridge.*
