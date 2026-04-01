# 0t. Idempotency and External Side-Effects

## Purpose

HelkinSwarm must tolerate retries, replays, duplicate deliveries, multi-round re-planning, and model over-eagerness **without emitting duplicate external side-effects**.

This addendum defines the repository’s canonical idempotency primitive for user-visible and externally committed actions.

## Proven Primitive

The canonical primitive is the outbound-artifact claim mechanism in `src/bot/conversationStore.ts`:

- `claimOutboundArtifact(conversationId, userId, kind, dedupKey)`
- `releaseOutboundArtifactClaim(conversationId, kind, dedupKey)`

It persists a claim document keyed by:

$$
\text{outbound document id} = \text{outbound-}\langle kind \rangle\text{-}\langle dedupKey \rangle
$$

If the same side-effect path is retried and the claim already exists, the second attempt is suppressed.

## Current Canonical Uses

| Side-effect | Location | Kind | Notes |
|---|---|---|---|
| Teams reply send | `src/orchestrator/sendReplyActivity.ts` | `reply` | suppresses duplicate proactive replies by correlation id |
| Confirmation card send | `src/orchestrator/sendConfirmationCardActivity.ts` | `confirmation-card` | suppresses duplicate approval cards |
| Outlook email send | `skills/outlook/handlers.ts` | `email-send` | suppresses duplicate mailbox sends within the same turn |

## Design Rules

### 1. Put the guard at the real side-effect boundary

Planner/orchestrator filtering is useful but not sufficient. The strongest protection must live where the external side-effect is actually emitted.

Examples:
- Teams message send → guard in `sendReplyActivity.ts`
- Outlook email send → guard in `skills/outlook/handlers.ts`
- Future GitHub issue/comment creation → guard in the GitHub write handler/activity

### 2. Dedup keys must be semantic, not merely textual

The dedup key should represent the **actual intended effect**.

For Outlook send this means normalizing things like:
- omitted vs explicit `bodyType: "text"`
- omitted vs explicit empty arrays for `cc`, `attachmentAssetIds`, `inlineAssets`
- ordering differences in recipient arrays
- case normalization where identifiers are case-insensitive

If a request is semantically the same, the dedup key should collide intentionally.

### 3. Scope the key appropriately

For per-turn protection, include the turn correlation in the dedup key.

Conceptually:

$$
\text{dedupKey} = \text{correlationId} : H(\text{canonical side-effect payload})
$$

That blocks duplicate retries inside one turn without accidentally preventing later intentional sends of the same email in a different turn.

### 4. Release only on pre-delivery failure

If the external system definitely did **not** receive the side-effect, release the claim.

If the side-effect may already have committed, do **not** release the claim just to make retries easier.

### 5. Duplicate suppression must remain honest

When a duplicate retry is blocked, the system must not claim the original action failed.

The correct semantics are:
- the original action may already have succeeded
- the duplicate retry was suppressed
- no second side-effect was emitted

## Outlook Email Case Study (#439)

The live bug that drove this pattern hardening was duplicate mailbox delivery for a single user request on the secondary lane.

Observed progression:
1. planner/follow-up duplicate suppression reduced some duplicate sends but did not eliminate them
2. semantically equivalent argument shapes still slipped through
3. handler-level idempotency at the actual `Graph /me/sendMail` boundary solved the mailbox duplication

Final live validation standard:
- one send request issued in Teams
- bot reply confirms send
- sent-items inspection finds **exactly one** matching subject

## Testing Standard

Every new external side-effect path should cover at least:

1. first-attempt success
2. duplicate retry suppression
3. claim release on pre-delivery failure
4. user-facing wording that does not falsely downgrade a successful original action into a failure

## Anti-Patterns

- relying on LLM obedience alone to avoid duplicate writes
- placing dedup only in the planner while leaving the emitter unguarded
- using raw JSON string equality for semantically equivalent requests
- releasing claims after ambiguous partial-delivery outcomes
