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
- ❌ Do NOT Use Playwright to type into or submit Teams message input
- ❌ Do NOT Use the Graph API `sendMessage` directly for test injection
- ❌ Do NOT Declare a fix verified without running at least one full TIK-TOK cycle
- ❌ Do NOT Skip correlation tagging when DevLoop messages are active

---

## Playwright MCP — Active Browser Agent (April 2026+)

The IDE-side Playwright MCP plugin is enabled with the operator's **active authenticated browser session**. The browser carries real OAuth tokens including Global Admin for Entra ID and the Teams app authenticated as the operator.

### What this enables (agent-actionable without waiting for user)

| Task | How |
|------|-----|
| OAuth sign-in card click (e.g. `/link entra`, `/link outlook`) | Navigate to Teams Web, find the Hero card, `click` the button |
| Entra admin consent for new Graph permissions | Navigate `https://entra.microsoft.com` → App registrations → Grant admin consent |
| Azure Portal resource inspection and minor config | Navigate `https://portal.azure.com` |
| Azure Bot Service OAuth connection verification | Navigate Azure Portal → Bot Service → Configuration → OAuth Connections |
| App registration permission management | Navigate Entra admin center → App registrations → API permissions |

### What this does NOT enable (still prohibited)

- ❌ Typing into the Teams message compose box — use `teams_test_full_probe` exclusively
- ❌ Clicking the Teams "Send" button — use `teams_test_full_probe` exclusively
- ❌ Any action that modifies infrastructure outside of Bicep/GitOps — file an infra issue instead
- ❌ Any destructive portal actions (delete, force close, etc.) — confirm with user first

### Standard auth-unblock workflow

When an issue is blocked on OAuth consent or admin portal action:
1. Use `teams_test_full_probe` to trigger the bot to send a sign-in card (e.g. send `/link entra`)
2. Use Playwright to navigate to Teams Web (`https://teams.microsoft.com`) and take a snapshot
3. Find the sign-in card and `click` the auth button
4. Complete the OAuth flow (the browser has the user's active session — consent auto-completes)
5. If a 6-digit code appears in the browser, copy it and send it via `teams_test_full_probe`
6. Validate the tool that previously required the token with a follow-up probe

### Entra admin consent workflow

When a new skill needs a Graph permission that requires admin consent:
1. Navigate `https://entra.microsoft.com` → Applications → App registrations → find the bot App ID
2. → API permissions → add the required permission → "Grant admin consent for PUTERSDCAT-CORP"
3. Confirm the grant is shown as "Granted for PUTERSDCAT-CORP"
4. Then proceed with OAuth re-link if a delegated token refresh is also needed

*We are the bridge.*
