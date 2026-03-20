# Pre-MVP Loop Prompt — v0.5 E2E Verified
**Milestone:** `v0.5 - Pre-MVP: E2E Verified`  
**Gate Issue:** [#111 PRE-MVP GATE: Full E2E Path Verification](https://github.com/putersdcat/HelkinSwarm/issues/111)

---

**Prompt to paste into a fresh Azure Agent session:**

```
You are working on HelkinSwarm — a personal sovereign AI copilot in Teams.

## Your Context

The bot is partially working: it receives messages and replies. However, the full E2E path has not been
formally verified, conversation references may not survive container restarts, and no automated test
tooling has been run against it yet.

The Teams Test Harness MCP server (`helkinswarm-teams-test`) is now available to you in this IDE session.
Use it for ALL verification — never use Playwright to send Teams messages.

## Your Mission

Work through every open issue in the `v0.5 - Pre-MVP: E2E Verified` milestone until issue #111 can be closed.
When #111 closes, pre-MVP is DONE.

---

## Step 1 — Pull your work queue

Run this to get your active issue list:

  gh issue list --milestone "v0.5 - Pre-MVP: E2E Verified" --state open --json number,title,body

Read every open issue. Read any linked spec documents cited in the body. Do not start writing code
until you have read the full spec for each issue.

Key open issues as of session start (re-run the command above to get live state):
  #33  Teams Test Harness MCP server implementation
  #22  Proactive reply mechanism & conversation reference store
  #111 [PRE-MVP GATE] Full E2E Path Verification — Teams → Router → Stamp → LLM → Reply

---

## Step 2 — Work issue #22 first: ConversationReference persistence

Before any E2E test can reliably pass across container restarts, the conversation reference must be
persisted in Cosmos DB — not just held in memory.

Spec: docs/07-Memory-Manager.md, docs/10-Teams-Interface.md

Check current state of `src/orchestrator/sendReplyActivity.ts` and `src/bot/HelkinSwarmBot.ts`:
  - Is the ConversationReference written to Cosmos DB on every inbound message?
  - Is it read from Cosmos DB in sendReplyActivity before calling continueConversation()?
  - If either answer is NO, that is a bug. Fix it.

The Cosmos DB container/client is already wired in `src/memory/`. Reuse existing patterns.

After fixing:
  - Commit and push to main with message: fix(#22): persist ConversationReference in Cosmos DB
  - Wait for deploy-stamp workflow to complete (check via: gh run list --workflow=deploy-stamp.yml --limit 3)
  - Then proceed to Step 3.

---

## Step 3 — Run the E2E probe

Once deploy-stamp is green, run the primary verification tool:

  teams_test_full_probe  →  message: "hello, are you there?"  →  timeoutSeconds: 60

Expected result shape:
  {
    "passed": true,
    "botReply": "<non-empty string>",
    "elapsed": "<N>s",
    "runtime": { "status": "healthy", ... }
  }

If `passed: false`:
  1. Run `teams_test_correlate_runtime` — check if the stamp health endpoint is responding
  2. Run `teams_test_get_recent` (count: 20) — check if the bot received and processed the message
  3. Check App Insights for the conversation ID: look for errors in the overseer or sendReplyActivity
  4. Fix the root cause, push, wait for deploy, re-probe. Do not close any issue until `passed: true`.

If `passed: true`:
  - Record the full probe output (botReply, elapsed, runtime) — you will need it for issue comments
  - Proceed to Step 4.

---

## Step 4 — Verify the full request path

Even with a passing probe, formally verify each hop in the path:

  Teams message → Router → Stamp → Overseer → SessionOrchestrator → LLM → sendReplyActivity → Teams reply

Check these specific wiring points (read the files — do not assume):

  1. ROUTER: `src/router/routerFunction.ts`
     - Does it extract `activity.from.aadObjectId`?
     - Does it look up `config/user-map.json` to find the correct stamp URL?
     - Does it proxy the full activity body to the stamp?

  2. STAMP ENTRY: `src/functions/messages.ts` and `src/bot/HelkinSwarmBot.ts`
     - Does `HelkinSwarmBot.ts` save the ConversationReference to Cosmos on every onMessage?
     - Does it start the overseer Durable orchestration?

  3. OVERSEER → SESSION: `src/orchestrator/overseer.ts` and `src/orchestrator/sessionOrchestrator.ts`
     - Does the sessionOrchestrator call the LLM layer?
     - Does it call sendReplyActivity with the LLM response?

  4. REPLY: `src/orchestrator/sendReplyActivity.ts`
     - Does it read ConversationReference from Cosmos DB?
     - Does it call `adapter.continueConversation()`?

For each gap you find: create a GitHub bug issue (sub-issue of #111 if actionable), fix it, push, re-probe.

---

## Step 5 — Close issues with evidence

For each issue you fix and verify:

  gh issue comment <NUMBER> --body "## Verified ✅

  **Probe result:** { passed: true, botReply: '...', elapsed: '...s' }
  **Commit:** <SHA>
  **Deploy run:** <run URL>
  **Runtime health:** <health endpoint output>

  ConversationReference is now persisted in Cosmos DB and survives container restarts.
  Closing."

  gh issue close <NUMBER>

---

## Step 6 — Close the gate (#111)

When all sub-issues are closed and `teams_test_full_probe` returns `passed: true`:

  1. Run a final fresh probe with a non-trivial message, e.g.: "What is 2 + 2?"
     - Confirm the LLM actually answered (not just an echo or error message)
  2. Run `teams_test_correlate_runtime` and confirm the stamp is healthy
  3. Comment on #111 with the full evidence package (probe result + correlation + deploy SHA)
  4. Close #111

When #111 is closed — **pre-MVP is complete.** You are done with this loop.

---

## Rules (non-negotiable)

- NEVER use Playwright to send Teams messages — `teams_test_full_probe` only
- NEVER close an issue without a `passed: true` probe result as evidence
- NEVER assume code is wired — read the file and cite the exact function + line
- ALWAYS wait for deploy-stamp workflow green before re-probing
- ALWAYS commit with the issue reference: `fix(#NN):` or `feat(#NN):`
- If you are unsure whether a fix is needed, READ the file. Do not guess.

---

## Reference: Key Files

| File | Purpose |
|------|---------|
| `src/bot/HelkinSwarmBot.ts` | Saves ConversationReference, starts overseer |
| `src/orchestrator/sendReplyActivity.ts` | Reads ConvRef from Cosmos, sends reply |
| `src/orchestrator/overseer.ts` | Eternal Durable overseer |
| `src/orchestrator/sessionOrchestrator.ts` | Per-message LLM turn |
| `src/router/routerFunction.ts` | Global router — aadObjectId → stamp |
| `src/memory/cosmosClient.ts` | Cosmos DB client |
| `config/user-map.json` | UPN → alias/stamp mapping |
| `docs/10-Teams-Interface.md` | Bot interface spec |
| `docs/07-Memory-Manager.md` | Cosmos DB memory spec |
| `docs/08-Orchestrator-Patterns.md` | Overseer/orchestrator spec |

---

## Reference: Key Endpoints

| Resource | URL |
|----------|-----|
| Stamp health | https://helkinswarm-func-a7f2.purplepebble-508e1162.eastus2.azurecontainerapps.io/api/health |
| Router | https://helkinswarm-router.salmonbeach-d4db91b5.eastus2.azurecontainerapps.io |

---

## Reference: Stamp Identity

| Property | Value |
|----------|-------|
| Subscription | `65b1d40b-8962-46cd-b2d7-fa5d09b787a1` |
| Tenant | `51b1f02a-e19b-4089-a5f6-3ebb72835521` |
| User alias | `a7f2` |
| User UPN | `eric@putersdcat.com` |
| User aadObjectId | `40f5c975-3aa2-47d8-b32d-a9d7a392f6dc` |

---

Begin with Step 1. Pull the live issue list now.
```

---

## How to Use This Prompt

1. Open a **fresh** GitHub Copilot Chat session in VS Code
2. Switch to the **Azure Agent** persona
3. Confirm `teams_test_full_probe` is visible in the agent tools list (it should be — MCP is registered in `.vscode/mcp.json`)
4. If this is the first time running MCP tools this session, the first call to any `teams_test_*` tool will trigger device-code auth — follow the instructions printed in the VS Code output panel
5. Paste the prompt block above in its entirety
6. The agent will work autonomously until #111 is closed

## Done Criteria

Pre-MVP is complete when:
- Issue **#111** is closed with a `passed: true` probe result as evidence
- `teams_test_full_probe` returns a genuine LLM response (not an error or echo)
- All v0.5 milestone issues are closed

Next step after pre-MVP: paste `docs/Proomptz/04-phase4.md` into a fresh session.
