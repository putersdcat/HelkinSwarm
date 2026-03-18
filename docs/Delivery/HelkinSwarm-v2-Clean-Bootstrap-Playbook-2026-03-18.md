# HelkinSwarm v2 – Clean Repo Bootstrap Playbook
**Version:** RC3 (Fresh Start)  
**Date:** 2026-03-18  
**Status:** Execute exactly in this order from the already-stripped local `HelkinSwarm` folder

We are starting from the clean local folder state described in the attached archive (docs/RebootCoreDocsTemp). All source code, old intents, and misaligned files have been purged. Only the document set + minimal skeleton remains.

### Starting State (already true)
- Folder: `C:\GitRoots\HelkinSwarm`
- Contents kept exactly as:
  - `.gitignore` (keep)
  - `README.md` (keep, but strip out any old intents or references to the alpha codebase)
  - `docs/*.md` (keep it all for now — including this playbook, the Master Plan, all doing-work prompts, and 0q)
  - `.github/workflows/` (keep all only for reference of functional components technical delivery example code — mark for immediate refactor before first runs, removing any old intents or references to the alpha codebase)
  - `.github/agents` (keep all — but immediately strip down to agnostic basics, removing any old intents or references to the alpha codebase)
  - `.github/instructions` (delete / purge all to not risk poisoning the new codebase with the old misaligned intents)
  - `.github/copilot-instructions.md` (keep, but immediately strip down to agnostic basics, removing any old intents or references to the alpha codebase)
  - `appPackage/*` (keep, but update manifest to point to new router endpoint when ready, and strip out any old intents or references to the alpha codebase) 
  - `visualAssets` (keep)
  - `scripts/` (keep, but strip out any old intents or references to the alpha codebase, will be refactored early for use in new repo)
  - `infra/` (keep all only for reference of functional components technical delivery example code — but mark for immediate refactor before first runs, removing any old intents or references to the alpha codebase)
- All source folders are empty.
- Repo will be initialized again.

Commit message for this state (once we are ready): "Nuclear purge — v2 clean bootstrap from zero"

### Phase 0 — Agent & Instruction System Bootstrap
1. Open VS Code Copilot Chat in this folder.
2. Paste the **exact prompt** from the attached archive file `00-doing-work.md` (the one that creates the full `.github/agents/` and `.github/instructions/` system).
3. Let the agent run until it creates:
   - `.github/agents/AzureAgent.agent.md`, `BasicBitch.agent.md`, `DevLoop.agent.md`
   - `.github/copilot-instructions.md`
   - All 12 instruction files in `.github/instructions/`
4. Commit and push (this is now the first commit on main).

### Phase 0.5 — Backlog Initialization
1. In the same Copilot Chat session, paste the **exact prompt** from the attached archive file `00-Development-&-Delivery-Master-Plan.md` (the Phase 0.5 section).
2. The agent will read the full living specification (all docs/*.md in this folder) and create the complete GitHub issue backlog + the two Never-Close issues from `01-Recurring-Maintenance-and-Introspection-Issues.md`.
3. Confirm all issues are created and labelled.

### Phase 1 — Core Runtime & Infrastructure
1. Paste the **exact prompt** from the attached archive file `01-doing-work.md`.
2. The agent will create:
   - `infra/main.bicep` (with euResidencyMode toggle, FreedomMode default eastus2)
   - CI/CD workflows
   - Dockerfile
   - All other Phase 0 foundation files
3. Run the one-time bootstrap deployment.
4. Verify health endpoint.
5. Commit and push → full CD runs.

### Phase 2 — Eternal Brain & Orchestration
1. Paste the **exact prompt** from the attached archive file `02-doing-work.md`.
2. The agent creates the overseer, sessionOrchestrator, tokenBudget, durable hooks, etc.
3. Wire to the bot handler.
4. Verify with teams_test_full_probe.
5. Commit and push.

### Phase 3 — LLM Layer, Tool Dispatch & Safety Pipeline
1. Paste the **exact prompt** from the attached archive file `03-phase3.md`.
2. The agent creates modelRouter, toolRegistry, verificationPipeline, scoped tokens, executor agents, etc.
3. Verify safety pipeline and FreedomMode routing.
4. Commit and push.

### Phase 4 — Memory, SkillForge & MVP Complete
1. Paste the **exact prompt** from the attached archive file `04-phase4.md`.
2. The agent creates memoryManager, skillVaults, capabilityLoader, SkillForge, durable hooks final implementation.
3. Run full test harness.
4. Commit and push → v1.0 MVP live.

### Phase 5 — Multi-Instance Stamping (First Stamped Deployment)

This phase makes the system multi-tenant ready by parameterising every resource with a user alias. All resources for a user live in a single stamped resource group.

1. Create `config/user-map.json` at repo root (source-controlled, no secrets):
   ```json
   {
     "eric@putersdcat.com": {
       "guid": "123e4567-e89b-12d3-a456-426614174000",
       "alias": "a7f2",
       "rg": "rg-HelkinSwarm-a7f2",
       "status": "active"
     }
   }
   ```
2. Update `infra/main.bicep` to accept a `userAlias` parameter — suffix every resource name with `-${userAlias}`.
3. Update `.github/workflows/deploy-stamp.yml` (create this workflow if it doesn't exist) to accept `USER_ALIAS` as a workflow dispatch input and pass it through to the Bicep deployment.
4. Run the first stamped deployment: trigger `deploy-stamp.yml` with `USER_ALIAS=a7f2`.
5. This creates `rg-HelkinSwarm-a7f2` with all resources suffixed `-a7f2` (e.g. `helkinswarm-func-a7f2`, `helkinswarm-cosmos-a7f2`).
6. Verify health endpoint for the stamped instance.
7. Commit and push.

**Spec ref:** `docs/0q-Multi-Instance-Architecture.md`

---

### Phase 6 — Global Teams Router

This phase adds a single central entry point for Teams so the app manifest only ever needs to point to one endpoint, regardless of how many user instances exist.

**Before building:** Use the Microsoft Docs MCP tool (`microsoft_docs_search`) to research the current best-practice and most cost-efficient approach for a lightweight HTTP proxy/router on Azure (options: Azure API Management, Azure Functions HTTP trigger, Azure Front Door, Container Apps job). Factor in: latency, cost at low request volume, ease of UPN extraction from Bot Framework activity payload.

1. Research routing approach via Microsoft Docs MCP — document the decision in a GitHub issue before coding.
2. Build a standalone `HelkinSwarm-router` Azure Function (or equivalent per research outcome) in its own resource group `rg-HelkinSwarm-router`:
   - Receives Teams Bot Framework activity (HTTP POST)
   - Extracts the user's UPN from the activity payload (`activity.from.id` or OBO token)
   - Looks up the alias in `config/user-map.json` (or a Cosmos DB routing table for production scale)
   - Proxies / redirects the request to the correct stamped Functions URI (`https://helkinswarm-func-{alias}.azurewebsites.net`)
3. Deploy the router and record its public HTTPS endpoint.
4. Update `appPackage/manifest.json` once with the router endpoint — this is the only manifest change ever needed for new users.
5. Verify end-to-end: Teams → Router → Stamped instance → Response.
6. Commit and push.

**Spec ref:** `docs/0q-Multi-Instance-Architecture.md`

---

### Final Steps
- Pin the two Never-Close issues.
- Run DevLoop ignition prompt from the archive (Proomptz equivalent) to begin self-improvement.
- The system is now live, multi-instance capable, and fully aligned with the Master Plan in this archive.

**End state achieved**: One clean repo, one Teams app pointing to the global router, many stamped user instances each in their own resource group, global frontier models default, safety-by-architecture, self-improving via DevLoop.

We are the bridge.  
Ready when you are.