**Here are the regenerated Markdown files** with your correct UPN `eric@putersdcat.com` fixed everywhere (user-map examples, comments, etc.). Everything else is identical to the previous version.

### 1. `docs/Delivery/Nuclear-Reset-Playbook-2026-03-18.md`

```markdown
# HelkinSwarm — Nuclear Reset & Multi-Instance Bootstrap Playbook
**Version:** RC2 (v2 clean start)  
**Date:** 2026-03-18  
**Status:** Execute exactly in this order

### Phase 0 — Pre-Reset Documentation Cleanup (do this first)
1. Expand the existing spec set:
   - Add `docs/0q-Multi-Instance-Architecture.md` (see below)
   - Update `docs/16-Final-Notes-and-Bootstrap.md` with new stamping instructions
   - Update `docs/03-Tech-Stack-Infrastructure.md` and `docs/12-Deployment-CICD.md` with `USER_ALIAS` parameter
   - Harvest any surviving valid features/bugs from old issues into `docs/specs/architecture-gaps.md` and `docs/specs/features.md`
2. Commit these changes to main in the current repo.

### Phase 1 — Isolate Old Repo
- GitHub → Settings → Rename repo from `HelkinSwarm` → `HelkinSwarm-Alpha`
- Local: `git remote set-url origin https://github.com/putersdcat/HelkinSwarm-Alpha.git`
- Tag: `git tag alpha-botched-2026-03-18 && git push origin alpha-botched-2026-03-18`
- Leave it untouched forever.

### Phase 2 — Blind Clone & Purge
```bash
git clone https://github.com/putersdcat/HelkinSwarm-Alpha.git HelkinSwarm-New
cd HelkinSwarm-New
```
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
- Commit: "Nuclear purge — v2 clean bootstrap from zero"

### Phase 3 — Republish Clean Repo
- GitHub: Create new private repo `HelkinSwarm` (empty)
- Add remote: `git remote add new https://github.com/putersdcat/HelkinSwarm.git`
- Push: `git push new main`
- This is now the canonical source. Zero issues. Zero history.

### Phase 4 — Mothball Legacy Deploy
```bash
az group update --name <Insert Existing RG Name> --tags "Status=archived" "Date=2026-03-18"
az functionapp scale set --name <Insert Existing Function App Name> --minimum-instances 0
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
- Incoming Teams activity → extract UPN → lookup alias in user-map → redirect to user-specific Functions URI.
- Update Teams app manifest once with the router endpoint.

**End state**: One clean repo, one Teams app, many stamped user instances. Legacy alpha mothballed.
```

### 2. `docs/0q-Multi-Instance-Architecture.md` (new addendum)

```markdown
# HelkinSwarm Multi-Instance Architecture (One-to-One User-Aligned Deployments)
**Status:** Core requirement from RC2 onward

### Core Principle
Every user gets a **dedicated, isolated Azure footprint**. No shared resources except global service principals and the single Teams app.

### Naming & Obfuscation Rules
- Resource Group: `rg-HelkinSwarm-[4-digit-alphanum]` (e.g. `rg-HelkinSwarm-a7f2`)
- All resources: suffix `-a7f2` (cosmos-HelkinSwarm-a7f2, func-HelkinSwarm-a7f2, etc.)
- User map stored in `config/user-map.json` (repo-level, gitignored or encrypted) <- just to clairify this needs to be stored on the GitHub Repo side, but but does not need encryption or GitIgnore since it contains no secrets, just the mapping of user email to alias and RG name for deployment purposes, and this is only a draft design and can be iterated on for better security or operational practices as needed, but for now this is the simplest approach to enable the multi-instance stamping requirement.

### Pipeline Integration
- New parameter in all workflows: `USER_ALIAS`
- Bicep dynamically builds names from alias
- Default for initial deployment: your UPN (eric@putersdcat.com) = alias `a7f2`

### Global Shared Components
- Entra App Registration + Service Principal: `HelkinSwarm-Core` (OAuth, GitHub integration)
- Teams app manifest: single global app
- Central router function (`HelkinSwarm-router`): routes incoming Teams activity by UPN → user-specific endpoint

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

### 3. Quick Updates to Existing Docs

**In `docs/03-Tech-Stack-Infrastructure.md`** (add new section near the end):
```markdown
### Multi-Instance Stamping
All Bicep resources now accept `userAlias` parameter. Resource names are suffixed with `-{{userAlias}}`. Default for initial deployment: `a7f2` (eric@putersdcat.com).
```

**In `docs/16-Final-Notes-and-Bootstrap.md`** (update the Bootstrap Guide section):
```markdown
Bootstrap now includes:
- Rename old repo to HelkinSwarm-Alpha
- Blind clone + purge
- Republish clean HelkinSwarm repo
- First stamped deployment with USER_ALIAS=a7f2 for eric@putersdcat.com
```

---

Save these three files (plus the small updates) into your current repo **before** you start the rename/clone step. They will be the only docs carried over.

When you're ready to execute, just say "start Phase 1" and we'll go step-by-step. All set?