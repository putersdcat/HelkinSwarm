## Ack Variants — Rotating Acknowledgment Messages + Braille Spinner

Repeatedly sending "Working on it..." is jarring and reveals the internal processing state. Ack variants rotate through a set of neutral messages and use a Braille spinner for in-place updates during long operations.

**Spec ref:** `docs/ADDENDA/ADDENDA-04-Capability-Hot-Reload-Tool-Registry-and-Confirmation-Cards.md`

---

## The Problem

Every turn starts with an ack: "Working on it...". In long multi-tool sessions, the orchestrator updates this ack in place as it processes each step. Seeing the same message repeatedly is:
1. Jarring to the user
2. A clue that the bot is doing multiple sequential operations (information leakage)

---

## Solution

### Rotating Variants (10 messages)

```
Working on it...
Processing...
Just a moment...
On it...
Let me check...
Looking into that...
Hold on...
Handling it...
Right away...
Sorting it out...
```

Messages rotate round-robin. No immediate repetition.

### Braille Spinner (in-place updates)

During long operations, update the ack every 3 seconds with a rotating Braille spinner:

```
⠋ Still working...
⠙ Still working...
⠹ Still working...
⠸ Still working...
⠼ Still working...
⠦ Still working...
⠧ Still working...
⠇ Still working...
⠏ Still working...
```

### Heartbeat Activity

**New file:** `src/bot/ackVariants.ts`

```typescript
export function pickAckVariant(): string   // Rotating variant
export function nextSpinnerFrame(): string  // Braille spinner frame

// Heartbeat activity updates ack every 3s during long operations
export async function heartbeatActivity(context: OrchestrationContext, ackActivityId: string): Promise<void>
```

---

## Acceptance Criteria

- [ ] 10 rotating ack variants with no immediate repetition
- [ ] Braille spinner updates every 3 seconds during long operations
- [ ] Spinner frames rotate through all 10 Unicode Braille patterns
- [ ] Heartbeat activity is fire-and-forget (does not block the turn)
- [ ] Ack variants are localized-ready (no hardcoded user-facing strings)
