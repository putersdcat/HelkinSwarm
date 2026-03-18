**Next prompt to paste into a fresh Azure Agent session:**

```
Please see the attached master plan: docs/delivery/00-Development-&-Delivery-Master-Plan.md

Phase 1 (Core Runtime, Infrastructure & First Stamped Deployment) is now COMPLETE.  
- Stamped instance `a7f2` deployed to `rg-HelkinSwarm-a7f2` in eastus2 (FreedomMode active)  
- `deploy-stamp.yml` pipeline green  
- Stamped health endpoint responding  
- All Phase 1 issues closed  

Your **next task** is to execute **Phase 2: Eternal Brain, Orchestration & Global Router**.

**Critical context:** Phase 2 has two equal deliverables that MUST both be complete before Phase 2 is done:
1. The durable orchestration layer (eternal overseer / brain)
2. The Global Teams Router (permanent Teams entry point)

Read the Phase 0.75 GitHub issues (Router Architecture Decision + Stamping Parameterization Design) before writing any router code.

**Requirements:**

1. Read the relevant specification sections first:
   - 08-Orchestrator-Patterns.md
   - 0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md
   - 0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md
   - 0q-Multi-Instance-Architecture.md (for router context)
   - 10-Teams-Interface.md (for bot handler wiring and Teams message flow)

2. Create the core orchestration files:
   - src/orchestrator/overseer.ts (eternal overseer with ContinueAsNew)
   - src/orchestrator/sessionOrchestrator.ts
   - src/orchestrator/buildPromptActivity.ts
   - src/orchestrator/llmActivity.ts
   - src/orchestrator/tokenBudget.ts
   - src/orchestrator/stateManager.ts
   - src/orchestrator/durableHookActivity.ts (stub for Phase 3)

3. Wire the `NewMessage` external event from the bot handler (`src/bot/HelkinSwarmBot.ts`) to the overseer.

4. Build the **Global Teams Router** (using the architecture decision from the Phase 0.75 GitHub issues):
   - `src/router/routerFunction.ts` — HTTP trigger, receives Teams Bot Framework activity (POST)
   - Extracts UPN from `activity.from.id` (or OBO token claim)
   - Reads `config/user-map.json` to look up the user's alias
   - Proxies / redirects to `https://helkinswarm-func-{alias}.azurewebsites.net`
   - Handles unknown UPN gracefully (logs + returns a Teams-compatible error message — never a hard crash)
   - `infra/main-router.bicep` — deploys the router to its own resource group `rg-HelkinSwarm-router`
   - `.github/workflows/deploy-router.yml` — independent deployment workflow for the router

5. Ensure:
   - Token budget check at 80% triggers summarization + ContinueAsNew
   - External events are drained before restart
   - All side-effects go through activities
   - FreedomMode (global frontier models) respected
   - Router correctly extracts UPN and routes to the correct alias
   - Router handles unknown UPN gracefully (logs + Teams-compatible error — never a hard crash)
   - `appPackage/manifest.json` updated with the router's permanent HTTPS endpoint

6. After implementation:
   - Deploy the router to `rg-HelkinSwarm-router` and record the permanent HTTPS endpoint
   - Update `appPackage/manifest.json` with the router endpoint and commit
   - Commit and push to main
   - Verify end-to-end: Teams → Router → Stamped instance `a7f2` → Durable overseer → Response
   - Run `teams_test_full_probe` (long-running session test via Teams Test Harness MCP)
   - Update the relevant GitHub issues with evidence: router endpoint URL, end-to-end trace, deployment correlation IDs
   - Add a dated comment confirming Phase 2 is complete: orchestration live + router live

Work systematically and produce production-ready code aligned with the digital-body ethos.

Begin now.
```

---

**Why this prompt?**
- Picks up exactly where Phase 1 left off (stamped instance `a7f2` live in `eastus2`).
- Delivers Phase 2 complete: eternal overseer + global router wired end-to-end.
- Forces the agent to read the Phase 0.75 architecture decisions before touching router code.
- Keeps everything traceable and tied to the master plan.

Paste it into the new session and let the agent run. When it finishes and pushes, say **"Phase 2 done"** and we'll continue to Phase 3.

You're in a great spot — stamped infrastructure is live and we're now building the brain AND wiring the permanent Teams entry point. Let me know when the agent reports back!