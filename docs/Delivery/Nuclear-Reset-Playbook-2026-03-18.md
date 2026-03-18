# HelkinSwarm — Nuclear Reset & Multi-Instance Bootstrap Playbook
**Version:** RC2 (v2 clean start)  
**Date:** 2026-03-18  
**Status:** Execute exactly in this order

### Phase 0 — Pre-Reset Documentation Cleanup
- Any surviving valid features/bugs from old issues have been harvested into `docs/XX-architecture-gaps.md` and `docs/XX-features.md`. - This means anythiung that is in the Issues now, bugs are not so important but any features that you know did not originate in the markdown files found under /docs/ folder, do you best to document them now, best effort is enough as they will not be totally lost.
- Commit all and push all local changes.
- Please stop any active GitHub Actions, especially deployments / pipelines that get triggered from this last push.

### Phase 1 — Isolate Old Repo
- USE GH CLI to Rename Repo, `gh repo rename -R putersdcat/HelkinSwarm HelkinSwarm-Alpha -y`
- FALL BACK ASK ME: GitHub → Settings → Rename repo from `HelkinSwarm` → `HelkinSwarm-Alpha`
- Local: `git remote set-url origin https://github.com/putersdcat/HelkinSwarm-Alpha.git`
- Tag: `git tag alpha-botched-2026-03-18 && git push origin alpha-botched-2026-03-18`
- Leave it untouched forever (no commits, no pipeline triggers).

### Phase 2 — Blind Clone & Local Purge
This part is tricky, I want the new repo to copy locally to use the HelkinSwarm root folder, so we need to do a rename of the existing folder to HelkinSwarm-OLAlphaD but this is also the VSCode Workspace folder, so things will freak out, so maybe we use local terminal PwsH to do a full copy of the existing workspace root, `C:\GitRoots\HelkinSwarm` to `C:\GitRoots\HelkinSwarm-Alpha`, then we can do the diconnection from the remote repo in the current working directory, `C:\GitRoots\HelkinSwarm`.
Then we have no need to do any clone etc, as we are already in the correct folder, we just need to do the purge of all the files and folders except the ones we want to keep, then we can do the commit and push to the new repo (later on in Phase 3).

- Delete everything except:
  - `.gitignore` (keep)
  - `README.md` (keep, but strip out any old intents or references to the alpha codebase)
  - `docs/*.md` (keep it all for now)
  - `.github/workflows/` (keep all only for reference of functional components technical delivry example code, - but mark for immediate refactor before first runs, removing any old intents or references to the alpha codebase)
  - `.github/agents` (keep all - but immediatly strip down to agnostic basics, removing any old intents or references to the alpha codebase)
  - `.github/instructions` (delete / purge all to not risk poisoning the new codebase with the old misaligned intents)
  - `.github/copilot-instructions.md` (keep, but immediatly strip down to agnostic basics, removing any old intents or references to the alpha codebase)
  - `appPackage/*` (keep, but update manifest to point to new router endpoint when ready, and strip out any old intents or references to the alpha codebase) 
  - `visualAssets` (keep)
  - `scripts/` (keep, but strip out any old intents or references to the alpha codebase, will be refactored early for use in new repo)
  - `infra/` (keep all only for reference of functional components technical delivry example code, - but mark for immediate refactor before first runs, removing any old intents or references to the alpha codebase)
- Not yet, repo will need to be intialized again... then Commit: "Nuclear purge — v2 clean bootstrap from zero"

### Phase 3 — Republish Clean Repo
- GitHub: Create new private repo `HelkinSwarm` (empty)
- Add remote: `git remote add new https://github.com/putersdcat/HelkinSwarm.git`
- Push: `git push new main`
- This is now the canonical source. Zero issues. Zero history.
- This process should have also taken care of the GitHub Copilot Chat specific memory purge, as the new repo has no history or issues, so the old codebase should be effectively removed from the context window of the Copilot Chat in relation to this new repo, but just in case maybe think if you can make some tool calls at this point to really ensure the memory is purged at this stage.

### Phase 4 — Mothball Legacy Deploy
```bash
az group update --name <old-rg-name> --tags "Status=archived" "Date=2026-03-18"
az functionapp scale set --name <old-func-name> --minimum-instances 0
```
- Update Teams app manifest: point to new central router endpoint (to be built in Phase 6).
- Rename old service principal in Entra ID → `HelkinSwarm-Alpha-SP`.

### Phase 4.5 — See Below Critical Note
CRITICAL NOTE: Now this is where things get a little confusing, you need to essentiall stop here, and point me to start initiating the prompt injections outlined here - `docs\Delivery\HelkinSwarm-v2-Clean-Bootstrap-Playbook-2026-03-18.md` but also it's not really well integrated into those prompts when and how these two items below should be factored into that process, so im giving you that final task before you send me over to the above bootstrap playbook, to take the two phase 5 and 6 below and integrate them into the phase 1-6 structure of the `HelkinSwarm-v2-Clean-Bootstrap-Playbook` in a way that makes sense, and then once you have done that, then you can send me over to start executing that playbook.

### Phase 5 — First Stamped Deployment
- In new repo, create `config/user-map.json` (example for eric@putersdcat.com):
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
- Update `.github/workflows/deploy-stamp.yml` with `USER_ALIAS` parameter.
- Run first deployment: `USER_ALIAS=a7f2` → creates `rg-HelkinSwarm-a7f2` and all suffixed resources.

### Phase 6 — Global Teams Router (future-proof)
Build one central `HelkinSwarm-router` Azure Function:
- This will need research with Microsoft Docs MCP to figure out the best practice approach for this, also cost efficient etc. 
- Incoming Teams activity → extract UPN → lookup alias in user-map → redirect to user-specific Functions URI.
- Update Teams app manifest once with the router endpoint.
