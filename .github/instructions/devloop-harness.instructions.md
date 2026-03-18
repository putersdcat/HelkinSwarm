---
applyTo: "src/**,tests/**"
---

# DevLoop Harness Rules
**Spec ref:** `docs/0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md`, `docs/09-DevLoop-Self-Improvement.md`

## Critical Rule
The DevLoop harness is a **wired feedback loop** between the deployed bot and the IDE-side agent. Every outbound message from the bot to the human in the loop must carry a correlation tag. Every test must inject via the Teams Test Harness MCP — never via Playwright or direct Graph API calls.

## Radio Protocol (Both Directions)

```
Outbound (bot → DevLoop agent):
SWARM: <content>  [DL-YYYYMMDDHHmmss-XXXX]  OVER

Inbound (DevLoop agent → bot):
DEVLOOP: <content>  [DL-YYYYMMDDHHmmss-XXXX]  OVER

DevQuery (human interrogation of DevLoop):
DEVQUERY: <question>  OVER
```

- Correlation tag format: `[DL-YYYYMMDDHHmmss-XXXX]` where `XXXX` is a random 4-digit hex
- Every bot response that is part of an active DevLoop session carries the tag
- Matching correlation tags link request → response for TIK-TOK validation

## TIK-TOK Cycle (Standard Validation Loop)

```
T  — Trigger      Send test message via teams_test_full_probe
I  — Inspect      Check logs / Cosmos state / orchestrator activity
K  — Korrelate    Match correlation tags, verify expected tool calls
T  — Tune         If gap found, prompt DevLoop to fix + self-deploy
O  — Observe      Wait for redeploy, validate outcome
K  — Keep         Commit model profile update if improvement confirmed
```

Validation requires sign-off from **at least 2 of 3 axes**:
1. **Outside-in** — what the user sees in Teams matches expected output
2. **Inside-out** — Cosmos + orchestrator state matches expected internal state
3. **Infra health** — Function App health endpoint + Application Insights shows no errors

## Teams Test Harness (Primary Tool)

```typescript
// Always use teams_test_full_probe for programmatic test message injection
await teamsTestHarness.fullProbe({
  userId: testUserId,
  message: "DEVLOOP: test outgoing email draft for boss  OVER",
  expectedBehaviors: ["tools.contains('outlook_draft_email')", "confirmation_sent"],
  correlationTag: "[DL-20260320143000-A7F2]"
});
```

- `teams_test_full_probe` is the **only** approved method of programmatic message injection
- Returns full correlation, tool call log, reply text, and orchestrator trace

## Key Files

| File | Responsibility |
|------|----------------|
| `src/devloop/correlationTagger.ts` | Mints correlation tags + attaches to responses |
| `src/devloop/radioProtocol.ts` | Parses `DEVLOOP:` / `DEVQUERY:` / `SWARM:` prefixes |
| `src/devloop/tikTokValidator.ts` | Automates the three-axis validation pass |
| `src/mcp/teamsTestHarness.ts` | Teams Test Harness MCP server wrapper |

## DevLoop Self-Deploy
- After a self-directed fix, DevLoop pushes to `main` and waits for `deploy-stamp.yml` to complete
- Health check is polled (with backoff) before proclaiming the fix live
- Never declare a fix "deployed" without confirming CI/CD completion and passing health check

## Always
- ✅ Attach correlation tags to all bot responses in an active DevLoop session
- ✅ Use `teams_test_full_probe` for all test message injection
- ✅ Validate from 2 of 3 axes before closing a TIK-TOK cycle
- ✅ Create a GitHub issue before acting on a complex discovered gap (devloop-practices.md)

## Never
- ❌ Use Playwright to type into or submit Teams message input
- ❌ Use the Graph API `sendMessage` directly for test injection
- ❌ Declare a fix verified without running at least one full TIK-TOK cycle
- ❌ Skip correlation tagging when DevLoop messages are active

*We are the bridge.*
