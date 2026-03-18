---
applyTo: "tests/**"
---

# Teams Testing Rules
**Spec ref:** `docs/14-Testing-E2E.md`, `docs/0n-Turn-by-Turn-Debug-Telemetry.md`

## Critical Rule
E2E tests via `teams_test_full_probe` are the **primary quality gate**. Unit and integration tests support it, but a passing unit test does NOT mean a feature is working — only a full-probe round-trip through the deployed bot does.

## Test Architecture

```
tests/
├── unit/          # Pure function tests — no I/O, no Azure SDK, no Bot Framework
├── integration/   # Cosmos, Key Vault, AI Foundry mocks — test service wrappers
├── e2e/           # Full probe tests via teams_test_full_probe
└── fixtures/      # Shared mock data, test users, seed conversations
```

## E2E Testing — Primary Gate

```typescript
// tests/e2e/outlook.probe.test.ts
import { teamsTestHarness } from "../../src/mcp/teamsTestHarness.js";

test("outlook_draft_email — creates a draft for boss", async () => {
  const result = await teamsTestHarness.fullProbe({
    userId: "testUser-a7f2",
    message: "Draft an email to my boss about today's late arrival",
    expectedToolCalls: ["outlook_draft_email"],
    expectedBehaviors: ["confirmation_sent"],
    expectedReplyContains: ["draft", "boss"]
  });
  expect(result.pass).toBe(true);
  expect(result.correlationTag).toMatch(/^\[DL-\d{14}-[A-F0-9]{4}\]$/);
});
```

- Every probe test validates: tool calls, confirmation gate (if applicable), reply content, and correlation tag
- Probes run against the **deployed stamp** (not local emulator) for CI validation

## Tool to Use for Each Testing Scenario

| Scenario | Correct Tool | NEVER Use |
|---|---|---|
| E2E functional verification | `teams_test_full_probe` | Playwright for message input |
| Visual layout / deep-link validation | Playwright (screenshot only) | Playwright for message sending |
| Unit function testing | vitest | Any live Azure service |
| Integration layer testing | vitest + Cosmos emulator | Real prod Cosmos |

## Playwright (Permitted — Visual Only)
- Screenshots for Adaptive Card layout verification
- Deep-link navigation testing
- Auth flow validation (visual sign-in redirect)
- **NEVER** use `page.fill(messageInput)` or `page.click(sendButton)` — this caused the 2026-03-05 incident

## Telemetry — Turn-by-Turn (0n)
- Every orchestrator turn emits structured telemetry: `{ turnId, userId, toolCalls, riskLevel, pipelineMs, modelName }`
- Test assertions can validate telemetry via the `teamsTestHarness` result
- Application Insights custom events are the source of truth for production validation

## Test Data Isolation
- Every test user ID is suffixed with the stamp alias: `testUser-{alias}`
- Test data is cleaned up in `afterEach` — no Cosmos pollution between tests
- Never run e2e tests against another user's stamp

## Performance Baselines (`model-profiles/`)
- `teams_test_full_probe` records latency P50/P90/P99 automatically
- Benchmark results are stored in `model-profiles/` by DevLoop
- A probe that meets functional requirements but exceeds P90 latency baseline triggers a model-profile tuning run

## Always
- ✅ Write at least one `teams_test_full_probe` E2E test for every new tool or flow
- ✅ Run `pnpm test` (unit + integration) before pushing — `pnpm test:e2e` in CI
- ✅ Verify telemetry fields are populated in every E2E assertion
- ✅ Clean up test data in `afterEach` — never leave Cosmos seeds across tests

## Never
- ❌ Use Playwright to type into or send Teams messages
- ❌ Call `teamsTestHarness.fullProbe` from unit or integration tests — e2e only
- ❌ Write tests that assume specific model names — use model lane assertions only
- ❌ Mark a feature "tested" without at least one passing full-probe result

*We are the bridge.*
