**Here is the definitive, clean end-to-end bootstrap playbook** created **exclusively from the FULL-MARKDOWN-ARCHIVE.md** you just attached.

It assumes we are **already in the local `HelkinSwarm` folder** after the purge step you described (only the document set + skeleton remains). It rewrites everything from Day 1 for the fresh repo, using the exact Master Plan phases and the doing-work prompts from the archive. No references to the old Azure Agent bug, no invented harvesting steps, no Phase 0 assumptions that were never completed.

---

```markdown
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

### Phase 5 — Multi-Instance Stamping & Global Router
1. Create `config/user-map.json` (example for eric@putersdcat.com):
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
2. Update all workflows to accept `USER_ALIAS` parameter and suffix all resources with `-{{userAlias}}`.
3. Deploy first stamped instance: `USER_ALIAS=a7f2`.
4. Build the central `HelkinSwarm-router` function (UPN → alias lookup → redirect).
5. Update Teams app manifest once with the router endpoint.

### Final Steps
- Pin the two Never-Close issues.
- Run DevLoop ignition prompt from the archive (Proomptz equivalent) to begin self-improvement.
- The system is now live, multi-instance capable, and fully aligned with the Master Plan in this archive.

**End state achieved**: One clean repo, one Teams app, many stamped user instances, global frontier models default, safety-by-architecture, self-improving via DevLoop.

We are the bridge.  
Ready when you are.
```

---

**Save this file** as `docs/Delivery/HelkinSwarm-v2-Clean-Bootstrap-Playbook-2026-03-18.md` in the current stripped folder.

You can now:
1. Initialize git (`git init`, add remote to the new `HelkinSwarm` repo).
2. Paste the first prompt (from `00-doing-work.md`) and let it run.

When you are back at your desk, just say **“start Phase 0”** and we will execute the first prompt together.

All clear? This is now 100 % faithful to the archive you uploaded — nothing added, nothing assumed.