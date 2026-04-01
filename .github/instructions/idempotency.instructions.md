---
applyTo: "src/orchestrator/**,src/bot/**,skills/**"
---

# Idempotency & External Side-Effects Rules
**Spec ref:** `docs/0t-Idempotency-and-External-Side-Effects.md`, `docs/08-Orchestrator-Patterns.md`, `docs/10-Teams-Interface.md`

## Critical Rule
Every externally visible side-effect must be protected by a **stable idempotency claim** before the side-effect is emitted. If the same turn is replayed, retried, or re-planned, HelkinSwarm must suppress the duplicate instead of performing the side-effect twice.

## Proven Primitive

Use the outbound-artifact claim helpers in `src/bot/conversationStore.ts`:

- `claimOutboundArtifact(conversationId, userId, kind, dedupKey)`
- `releaseOutboundArtifactClaim(conversationId, kind, dedupKey)`

Supported `kind` values currently include:
- `reply`
- `confirmation-card`
- `email-send`

This is the **canonical duplicate-side-effect guard** for user-visible sends in this repository.

## How to Apply It

1. Build a **canonical dedup key** from the real semantic action, not brittle raw text formatting.
2. Include the current turn correlation in the dedup key unless the action is intentionally cross-turn idempotent.
3. Claim **before** calling the external system.
4. If the claim fails, return an honest duplicate-suppressed result and do **not** emit the second side-effect.
5. If the side-effect fails before delivery/commit, release the claim.
6. Keep the duplicate-suppressed result explicit that the **original action may already have succeeded** earlier in the same turn.

## Design Guidance

### Prefer the guard nearest the real side-effect
- Orchestrator-level duplicate filtering is helpful but not sufficient on its own.
- The strongest protection lives at the boundary that actually emits the effect (for example: the mail send handler, Teams reply sender, hook registration activity).

### Canonicalize arguments
- Normalize omitted defaults vs explicit defaults.
- Sort logically unordered arrays (`to`, `cc`, attachment ids).
- Normalize content IDs and other case-insensitive identifiers.
- Hash the canonical payload if the raw key would be too large.

### Test all three paths
- first send succeeds
- duplicate retry is suppressed
- failed pre-delivery send releases the claim

## Always
- ✅ Reuse `claimOutboundArtifact` / `releaseOutboundArtifactClaim` for new user-visible side-effects when the shape fits
- ✅ Put the idempotency guard in the activity/handler that actually emits the side-effect
- ✅ Return honest duplicate-suppressed summaries
- ✅ Add focused regression tests for duplicate suppression and claim release

## Never
- ❌ Do NOT rely on LLM obedience alone to avoid duplicate external actions
- ❌ Do NOT use raw JSON string equality as the only dedup strategy for semantically equivalent actions
- ❌ Do NOT keep an idempotency claim when the external side-effect definitely failed before delivery
