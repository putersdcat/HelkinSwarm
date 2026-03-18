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

### Phase 0.5 — Backlog Initialization - Use OPUS NOW !
1. In the same Copilot Chat session, paste the **exact prompt** from `docs/Proomptz/FireStarter.md`.
   - That file contains the complete, self-contained backlog creation prompt ready to paste as-is.
   - Alternatively, run `scripts/Create-Backlog.ps1` directly (it creates all GitHub issues via `gh` CLI) — but read it first and confirm milestones are accurate.
2. The agent will read the full living specification (all docs/*.md in this folder) and create the complete GitHub issue backlog + the two Never-Close issues from `01-Recurring-Maintenance-and-Introspection-Issues.md`.
3. Confirm all issues are created and labelled.

### Phase 0.75 — Architecture Research: Global Router & Stamping Design

This is a mandatory research-and-design gate. Zero code is written here. Every decision made here directly shapes what Phase 1 builds. Complete before touching any infrastructure.

1. Use the **Microsoft Docs MCP tool** (`microsoft_docs_search`) to research the current best-practice and most cost-efficient HTTP routing approach on Azure for a personal-scale Bot Framework proxy. Evaluate:
   - Azure Functions HTTP trigger (consumption plan — near-zero idle cost)
   - Azure API Management (Consumption tier)
   - Azure Front Door
   - Container Apps job
   - Factor in: latency at near-zero request volume, ease of UPN extraction from Bot Framework activity payload, operational simplicity for a single-developer project
2. Research the multi-instance stamping parameterization pattern in Azure Bicep + Container Apps.
3. Document both decisions in two GitHub issues **before any code is written**:
   - **Issue: Router Architecture Decision** — chosen approach, cost model, UPN extraction method, and rejected alternatives with rationale
   - **Issue: Stamping Parameterization Design** — `userAlias` convention, `config/user-map.json` schema, resource naming suffix pattern (`helkinswarm-{resourceType}-{alias}`), how `deploy-stamp.yml` will be triggered
4. Both issues must be reviewed and approved (by you) before proceeding to Phase 1.

**Output gate:** Two GitHub issues created and reviewed. Zero infrastructure code written.

**Spec ref:** `docs/0q-Multi-Instance-Architecture.md`

#### Phase 0.75 Decision Outcome (Approved)

These decisions are now locked by approved issues:
- `#17` Router Architecture Decision
- `#18` Stamping Parameterization Decision

Use them as authoritative implementation input in Phase 1+:

1. **Router runtime:** Azure Functions HTTP trigger on Consumption plan (`helkinswarm-router`)
2. **Routing identity key:** `activity.from.aadObjectId` (not `activity.from.id`)
3. **Stamp alias format:** required `USER_ALIAS` matching `^[a-z0-9]{4}$`
4. **Stamp naming rule:** `helkinswarm-{resourceType}-{alias}` and RG `rg-helkinswarm-{alias}`
5. **deploy-stamp path:** only `deploy-stamp.yml` is allowed for stamp provisioning
6. **user-map schema anchor:** keyed by Entra object ID with alias+endpoint+enabled fields

---

### Phase 1 — Core Runtime, Infrastructure & First Stamped Deployment

Multi-instance stamping is built in from day one. There is no "plain" deployment. The **first live deployment IS a stamped user instance** (`a7f2`).

1. Paste the **exact prompt** from `docs/Proomptz/01-doing-work.md`.
2. The agent will create:
   - `config/user-map.json` at repo root (source-controlled, no secrets):
     ```json
     {
      "version": 1,
      "users": {
         "123e4567-e89b-12d3-a456-426614174000": {
            "alias": "a7f2",
            "upn": "eric@putersdcat.com",
            "endpoint": "https://helkinswarm-func-a7f2.placeholder.eastus2.azurecontainerapps.io/api/messages",
            "enabled": true
         }
      }
      }
     ```
   - `infra/main.bicep` — accepts `userAlias` parameter (required, no default); every resource name suffixed `-${userAlias}`. Full stack: UAMI, Container Apps, Cosmos DB, AI Foundry, Key Vault, Bot Service, App Insights. `euResidencyMode` flag defaults false; FreedomMode (`eastus2`) is the default.
   - `infra/main.parameters.json`
   - `.github/workflows/deploy-stamp.yml` — accepts `USER_ALIAS` as a required `workflow_dispatch` input; passes through to Bicep. This is the ONLY deployment workflow.
   - `.github/workflows/ci.yml` — build + lint + test only (no deployment)
   - `.github/workflows/teams-package.yml`
   - `Dockerfile`, `.gitignore`, and all other Phase 1 foundation files
3. Run the first stamped deployment: trigger `deploy-stamp.yml` with `USER_ALIAS=a7f2`.
   - Creates `rg-HelkinSwarm-a7f2` with all resources suffixed `-a7f2` (e.g. `helkinswarm-func-a7f2`, `helkinswarm-cosmos-a7f2`)
4. Verify health endpoint for the stamped instance: `https://helkinswarm-func-a7f2.azurewebsites.net/api/health` (or equivalent Container Apps URL).
5. Commit and push → CI runs clean.

**Spec ref:** `docs/0q-Multi-Instance-Architecture.md`, `docs/03-Tech-Stack-Infrastructure.md`, `docs/12-Deployment-CICD.md`

### Phase 2 — Eternal Brain, Orchestration & Global Router

Two equal deliverables that MUST both be complete before Phase 2 is done: the durable orchestration layer AND the Global Router. Teams is fully wired end-to-end by the end of this phase.

1. Paste the **exact prompt** from `docs/Proomptz/02-doing-work.md`.
2. The agent creates the core orchestration files:
   - `src/orchestrator/overseer.ts` (eternal overseer with ContinueAsNew at 80% context)
   - `src/orchestrator/sessionOrchestrator.ts`
   - `src/orchestrator/buildPromptActivity.ts`
   - `src/orchestrator/llmActivity.ts`
   - `src/orchestrator/tokenBudget.ts`
   - `src/orchestrator/stateManager.ts`
   - `src/orchestrator/durableHookActivity.ts` (stub for Phase 3)
3. Wire the `NewMessage` external event from the bot handler to the overseer.
4. The agent also builds the **Global Teams Router** (using the decision from Phase 0.75 GitHub issues):
   - `src/router/routerFunction.ts` — HTTP trigger, receives Teams Bot Framework activity (POST)
   - Extracts immutable Entra object ID from `activity.from.aadObjectId`
   - Reads `config/user-map.json` to look up alias
   - Proxies / redirects to `https://helkinswarm-func-{alias}.azurewebsites.net`
   - `infra/main-router.bicep` + `.github/workflows/deploy-router.yml` created
   - Deploys to `rg-HelkinSwarm-router` (separate RG from user stamps)
5. Update `appPackage/manifest.json` with the router's permanent HTTPS endpoint.
6. Verify end-to-end: Teams → Router → Stamped instance `a7f2` → Durable overseer → Response.
7. Commit and push.

**Spec ref:** `docs/08-Orchestrator-Patterns.md`, `docs/0q-Multi-Instance-Architecture.md`, `docs/10-Teams-Interface.md`

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

---

### Final Steps
- Pin the two Never-Close issues.
- Run DevLoop ignition prompt from the archive (Proomptz equivalent) to begin self-improvement.
- The system is now live, multi-instance capable, and fully aligned with the Master Plan in this archive.

**End state achieved**: One clean repo, one Teams app pointing to the global router, many stamped user instances each in their own resource group, global frontier models default, safety-by-architecture, self-improving via DevLoop.

We are the bridge.  
Ready when you are.