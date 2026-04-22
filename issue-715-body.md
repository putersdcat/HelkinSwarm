# Swarm 100% failure — `Cannot cancel a completed task` in swarmOrchestrator + cascading `.map of undefined` in sessionOrchestrator

**Severity:** CRITICAL — every single swarm (other than the rare ack-only success) is failing the same way.
**Discovered while validating:** #714 fix (SESSION_TIMEOUT_MS 5→16min). The #714 fix is correctly deployed (verified `Deploy Stamp` run `24787808244`, success in 9m46s). PROBE-714-SWARM at 16:03 still failed identically — so the timeout was NOT the only/dominant root cause.

## Forensic evidence — PROBE-714-SWARM (corr `98afe7fb-e89b-4ad5-9266-14b2122da5ac`)

Read directly from Cosmos `sessions` container + Durable Functions `HelkinSwarmHubInstances` table on Storage account `helkinswarmsta7f2` (AAD-only, agent identity).

```
Swarm doc: id=swarm-2a7325bf-8e35-41bd-bba1-60010130d907
  status=running success=False durMs=0 tok=5278 (decomposer-only)
  agentResults count=0  chatroomTranscript count=0
  leaderError= persistenceWarning=
  executedAt=2026-04-22 16:04:01

Durable instances (HelkinSwarmHubInstances) launched 16:03..16:10:
  16:03:23  overseer                   Running   PK=overseer-40f5c975-...
  16:03:37  sessionOrchestrator        FAILED    completed 16:08:00
            OUT="Orchestrator function 'sessionOrchestrator' failed:
                 Cannot read properties of undefined (reading 'map')"
  16:04:02  swarmOrchestrator          FAILED    completed 16:07:59
            OUT="Orchestrator function 'swarmOrchestrator' failed:
                 Cannot cancel a completed task."
  16:07:53  @swarmchatroom@swarm-2a7325bf-...   Running (LEAKED)
```

Critically:
- The bot sent the `🧠 Swarm engaged` ack at 16:03:22 (`skipOutboundClaim:true`) but **never** sent any synthesis reply, error reply (`⚡ The multi-agent analysis failed…`), or timeout reply for corr `98afe7fb`. The user got silence.
- The `swarm-2a7325bf` doc remained `status='running'` forever — never reached terminal `ok`/`partial`/`fail` because the post-swarm persist block never executed.
- The overseer instance is still `Running` (orphan-hang). The chatroom entity is leaked Running.
- The only outbound activity post-swarm was for **other** correlations (`PI-MOA8SLWZ` 16:05:32, `PI-MOA8SST8` 16:10:19) which are different probes / pending intents, NOT the swarm corr — confirming `lastSuccessAt` in `correlate_runtime` is misleading for swarm forensics.

## Root cause #1 — `swarmOrchestrator` calls `.cancel()` on already-completed timers

[`src/orchestrator/swarm/swarmOrchestrator.ts`](src/orchestrator/swarm/swarmOrchestrator.ts) has FOUR unsafe `.cancel()` sites that fire UNCONDITIONALLY after `Task.any([task, timer])` — i.e. they cancel the timer even when the timer was the winner (already completed):

| Line | Context | Pattern |
|------|---------|---------|
| [194](src/orchestrator/swarm/swarmOrchestrator.ts#L194) | retry-worker loop after worker timeout | `retryTimer.cancel();` after `Task.any` regardless of winner |
| [411](src/orchestrator/swarm/swarmOrchestrator.ts#L411) | leader delegation pass | `delegationTimer.cancel();` regardless of winner |
| [482](src/orchestrator/swarm/swarmOrchestrator.ts#L482) | sub-session interception loop | `subTimers[si].cancel();` regardless of winner |
| [595](src/orchestrator/swarm/swarmOrchestrator.ts#L595) | second-pass fan-in | `secondPassTimers[i].cancel();` regardless of winner |

Compare the SAFE sites at [L154](src/orchestrator/swarm/swarmOrchestrator.ts#L154) (worker fan-in) and [L681](src/orchestrator/swarm/swarmOrchestrator.ts#L681) (leader synthesis) — both are inside the `else` branch where the task (not timer) won.

For PROBE-714-SWARM most likely L194 fired: a worker timed out (240s), retry was scheduled, retry also lost to retryTimer (or completed exactly at the deadline), then `retryTimer.cancel()` threw → the whole `swarmOrchestrator` is killed mid-stream → the chatroom entity isn't `destroy`-signaled (or signal arrives but entity stays Running) → swarmTask.result throws in sessionOrchestrator.

## Root cause #2 — `sessionOrchestrator` `.map of undefined` after swarm failure

When `swarmOrchestrator` fails, the parent `sessionOrchestrator`'s `try { swarmTask.result … } catch` correctly catches the swarm error and writes a synthetic failure persist input. However something in the post-swarm code path then throws `Cannot read properties of undefined (reading 'map')` at 16:08:00. This kills the parent before it can either (a) call `persistSwarmResultActivity` with the failure record OR (b) call `sendReplyActivity` for the failure synthesis, leaving the swarm doc stuck `status='running'` and the user with no reply at all.

Likely culprits in [`src/orchestrator/sessionOrchestrator.ts`](src/orchestrator/sessionOrchestrator.ts) around the swarm block (L1545–L1640):
- [L1604](src/orchestrator/sessionOrchestrator.ts#L1604) `swarmAgentBreakdown: swarmResultData?.agentResults.map(...)` — the `?.` chains to `.agentResults` only; while semantically safe when `swarmResultData` is undefined, JS evaluation could trip if `swarmResultData` is partially populated.
- [`withSwarmPersistTimeout`](src/orchestrator/sessionOrchestrator.ts#L189) and [L186](src/orchestrator/sessionOrchestrator.ts#L186) `subAgentActivity` helper also have unconditional `timer.cancel()` patterns.

Independent of which exact line throws, the failure mode is **fatal silent failure of the synthesis + persist path** — no user-visible output and no terminal-status doc. The 4-hour ingress hold (#693 / #711) compounds it: the overseer is left holding `MindSessionGuard` against the user.

## Why #714 deploy didn't help

#714 raised the overseer's wall-clock timeout from 5 to 16 min. The actual failure happens at ~5 min into the swarm regardless (worker+retry+timer-cancel race), well inside both the new and old caps. Bumping the cap was necessary (the floor inversion was real) but not sufficient.

## Proposed fix

1. **Defensive `safeCancel` helper** in `swarmOrchestrator.ts` and `sessionOrchestrator.ts`:
   ```ts
   function safeCancel(t: df.TimerTask): void { try { t.cancel(); } catch { /* timer already completed */ } }
   ```
   Apply to all 6 unconditional `.cancel()` sites identified above.

2. **Source-pin test** asserting all `.cancel()` calls in `swarmOrchestrator.ts` go through `safeCancel` (or are inside `else { winner === task }` blocks).

3. **Defensive try/catch** around the post-swarm persist + footer + sendReply block in `sessionOrchestrator.ts` so that ANY downstream throw still produces a `status='fail'` persist doc and a user-visible `⚡ The multi-agent analysis failed before the final synthesis…` reply.

4. **Clear `MindSessionGuard` + ingress stage on this code path's catch** so the overseer doesn't leave the user pinned for 4h.

5. **Re-probe** with `PROBE-715-SWARM` and confirm:
   - Cosmos doc reaches `status` ∈ {`ok`, `partial`, `fail`} with `executionDurationMs > 0`
   - User receives synthesis or honest failure reply
   - No leaked `@swarmchatroom@*` Running entity
   - Overseer instance returns to a clean Running-waiting-for-event state

## Cleanup needed (one-shot)

- Terminate the orphan `overseer-40f5c975-3aa2-47d8-b32d-a9d7a392f6dc-275026b74f89` instance
- Destroy the leaked `@swarmchatroom@swarm-2a7325bf-8e35-41bd-bba1-60010130d907` entity
- Mark the stuck `swarm-2a7325bf-...` Cosmos doc as `status='fail'` with this issue id in `persistenceWarning`

## Citations

- Cosmos `sessions/swarm-2a7325bf-...` — read 2026-04-22T16:18Z via cert-bound `HelkinSwarm-LocalAgent` AAD
- Storage `HelkinSwarmHubInstances` — same auth, filter `CreatedTime ge '2026-04-22T15:50:00Z' and CreatedTime le '2026-04-22T16:30:00Z'`
- `src/orchestrator/swarm/swarmOrchestrator.ts` lines 154, 194, 411, 482, 595, 681
- `src/orchestrator/sessionOrchestrator.ts` lines 186, 208, 1604, 1545–1640
- `src/orchestrator/overseer.ts` lines 488 (#714 fix), 596+ (#711 inline finalize)
- Deploy Stamp run `24787808244` (success, 9m46s) — confirms #714 code is live
