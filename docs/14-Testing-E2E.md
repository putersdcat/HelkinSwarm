# HelkinSwarm Project Specification

## 14. Testing & E2E (Refined)

### Testing Philosophy

Testing in HelkinSwarm is **E2E-first**. Because the system is a live Teams bot with real external integrations (Outlook, Graph, GitHub, Azure, durable hooks), the highest-confidence validation comes from exercising the full stack exactly as a user would.

Unit tests exist only where they add clear value (parsers, token budget logic, canonicalizers). Everything else is validated through safe, repeatable E2E flows that run through the complete safety pipeline (0e), just-in-time skill memory (0i), Hydra-Net (0k), and durable hooks (0h).

### Primary Testing Tool: Teams Test Harness MCP

**This is the only allowed way to send test messages programmatically.**

The `Helkin-teams-test-harness` MCP server (registered in `.vscode/mcp.json`) uses Graph API with a **hardcoded safe chat ID**. It is architecturally impossible to send a test message to the wrong chat.

#### Core Tools

| Tool                        | Purpose |
|-----------------------------|-------|
| `teams_test_full_probe`     | ⭐ **Recommended** — send message + wait for reply + correlate runtime + skill memory + durable hooks in one call |
| `teams_test_send_probe`     | Send message only |
| `teams_test_get_recent`     | Read recent messages from the HelkinSwarm chat |
| `teams_test_wait_for_bot_reply` | Poll for reply with timeout |
| `teams_test_correlate_runtime` | Fetch health + session status + active durable hooks (0h) |

**Standard E2E procedure** (use this in 95% of cases):
```powershell
teams_test_full_probe "list my most recent emails and summarize the important ones"
```

The result includes:
- `passed: true/false`
- `botReply` (full text)
- `runtime.health` (LLM, memory, safety status)
- `skillMemoryInjected` (0i)
- `durableHooksRegistered` (0h)
- `correlationId` and elapsed time

### Playwright Restrictions (Strict)

**Playwright is allowed ONLY for visual inspection**, never for sending messages.

Allowed:
- Taking screenshots of rendered Adaptive Cards
- Navigating to the chat deep-link for visual verification
- Completing browser-based auth flows (one-time)

**Forbidden**:
- Typing into or submitting any Teams message input box
- Clicking “Send” on any message
- Any automation that could post to the wrong chat

### DevLoop Autonomous Testing (0g)

The DevLoop ignition prompt drives the TIK-TOK cycle:
- **TIK** — implement + push + deploy + validate with full harness across all models → close + label “devloop-validated”
- **TOK** — re-validate closed issues missing the label
- **Discovery Mode** — interrogate runtime, probe each model, audit memory consistency (0i), durable hooks (0h), and Hydra-Net (0k)

All benchmark results are stored in `model-profiles/` and become part of the Git history.

### Local vs Live Testing

| Environment | LLM Access | Teams Integration | Recommended For |
|-------------|------------|-------------------|-----------------|
| **Local**   | Mock / local Foundry endpoint | Bot Emulator + Test Harness | Fast iteration on prompt logic, safety gates |
| **Live**    | Real global/EU models | Real Teams chat | Full E2E validation, DevLoop benchmarks, durable hook testing (0h) |

The Test Harness works in both environments — it always talks to the live runtime.

### CI Integration

- `ci.yml` runs lint + compile + type-check
- Manual dispatch of `teams-package.yml` for Teams app validation
- Full E2E smoke test is triggered manually after major changes (via Test Harness)

### What NOT to Do

- ❌ Never use Playwright to send messages in Teams (this caused the 2026-03-05 incident)
- ❌ Never create test messages manually in the Teams web UI when the harness can do it
- ❌ Never merge changes without at least one successful `teams_test_full_probe`
- ❌ Never disable correlation IDs in tests
- ❌ Never test without running through the full safety pipeline (0e) and just-in-time memory (0i)
