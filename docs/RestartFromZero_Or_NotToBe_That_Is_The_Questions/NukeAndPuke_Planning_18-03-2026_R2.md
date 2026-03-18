**Here are the corrected Markdown files**, now using **your exact verbatim language** for the "Delete everything except" section in Phase 2. No assumptions, no re-imagining, no extra references to `12-Deployment-CICD.md` or anything else.

---

### 1. `docs/Delivery/Nuclear-Reset-Playbook-2026-03-18.md`

```markdown
# HelkinSwarm — Nuclear Reset & Multi-Instance Bootstrap Playbook
**Version:** RC2 (v2 clean start)  
**Date:** 2026-03-18  
**Status:** Execute exactly in this order

### Phase 0 — Pre-Reset Documentation Cleanup
- `docs/0q-Multi-Instance-Architecture.md` is already present and expanded. (already completed)
- Any surviving valid features/bugs from old issues have been harvested into `docs/XX-architecture-gaps.md` and `docs/XX-features.md`.
- Commit these changes.

### Phase 1 — Isolate Old Repo
- GitHub → Settings → Rename repo from `HelkinSwarm` → `HelkinSwarm-Alpha`
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

### Phase 4 — Mothball Legacy Deploy
```bash
az group update --name <old-rg-name> --tags "Status=archived" "Date=2026-03-18"
az functionapp scale set --name <old-func-name> --minimum-instances 0
```
- Update Teams app manifest: point to new central router endpoint (to be built in Phase 6).
- Rename old service principal in Entra ID → `HelkinSwarm-Alpha-SP`.

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

**End state**: One clean repo, one Teams app, many stamped user instances. Legacy alpha mothballed.
```

---

### 2. `docs/0q-Multi-Instance-Architecture.md` (unchanged from your archive — confirmed aligned)

```markdown
# HelkinSwarm Multi-Instance Architecture (One-to-One User-Aligned Deployments)
**Status:** Core requirement from RC2 onward

### Core Principle
Every user gets a **dedicated, isolated Azure footprint**. No shared resources except global service principals and the single Teams app. (however during development, its just understood the only existing instance will also be linked up to the development machinery of the main developer, so it will be used for development and testing, but it is still a one-to-one deployment, just with one user for now).

### Naming & Obfuscation Rules
- Resource Group: `rg-HelkinSwarm-[4-digit-alphanum]` (e.g. `rg-HelkinSwarm-a7f2`)
- All resources: suffix `-a7f2` (cosmos-HelkinSwarm-a7f2, func-HelkinSwarm-a7f2, etc.)
- User map stored in `config/user-map.json` (repo-level, gitignored or encrypted)

### Pipeline Integration
- New parameter in all workflows: `USER_ALIAS`
- Bicep dynamically builds names from alias
- Default for initial deployment: your UPN (eric@putersdcat.com) = alias `a7f2`

### Global Shared Components
- Entra App Registration + Service Principal: `HelkinSwarm-Core` (OAuth, GitHub integration)
- Teams app manifest: single global app
- Central router function (`HelkinSwarm-router`): routes incoming Teams activity by UPN → user-specific endpoint - this will need research with Microsoft Docs MCP to figure out the best practice approach for this, also cost efficient etc. 

### Deployment Flow
1. Commit to main
2. Pipeline reads `USER_ALIAS`
3. Stamps new RG + resources (or updates existing)
4. Legacy alpha RG remains untouched (mothballed)

### Future Expansion
- Add new user → add entry to user-map.json → run pipeline with new alias
- No code changes required

This construct is enforced from the first clean deployment onward.
```

---

These two files are now **100% faithful** to your exact wording and the full archive. Save them in the current repo (they are ready).

When you're ready, just say **"start Phase 1"** and we'll do the rename + blind clone step-by-step. All clear?