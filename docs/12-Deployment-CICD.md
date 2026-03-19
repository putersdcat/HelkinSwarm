# HelkinSwarm Project Specification

## 12. Deployment & CI/CD (Refined)

### Overview

The entire HelkinSwarm stack is **100% GitOps-driven**. Every change — infrastructure, code, models, SkillForge base image, or Teams app package — is deployed automatically on `git push main`. There are **no manual portal clicks** after the very first resource group creation.

The pipeline is intentionally simple, observable, and safe for a personal project that may later become open-source or commercial.

### GitHub Actions Workflows

| Workflow              | Trigger                  | What It Does |
|-----------------------|--------------------------|--------------|
| `ci.yml`              | Every push + PR          | Lint, TypeScript compile, type-check, Bicep validation |
| `cd.yml`              | Push to `main`           | Bicep deploy → Docker build → ACR push → Container Apps update + SkillForge base image sync |
| `deploy-stamp.yml`    | Manual dispatch (`USER_ALIAS`) | Deploys a complete stamped user instance (RG + all resources) |
| `deploy-router.yml`   | Manual dispatch          | Deploys the global router (rg-helkinswarm-router + Bot Service + Teams channel). Sets `BOT_APP_ID` and `ROUTER_UAMI_ID` GitHub variables. |
| `deploy-tabs.yml`     | Manual dispatch          | Deploys the global tab SPA (rg-helkinswarm-tabs + Azure Storage static website). Sets `TAB_HOST_URL` GitHub variable. |
| `teams-package.yml`   | Manual dispatch + push to `appPackage/**` | Substitutes `{{BOT_APP_ID}}`, `{{TAB_HOST_URL}}`, `{{TAB_HOST_DOMAIN}}` in manifest.json, then produces a sideloadable zip |

All workflows use **OIDC federation** (no secrets stored in GitHub).

### Bicep Deployment (Single Source of Truth)

`infra/main.bicep` (cross-referenced from **03-Tech-Stack-Infrastructure.md**) is the single source of truth. It deploys:

- Resource Group
- UAMI + RBAC assignments
- Key Vault
- Cosmos DB Serverless + DiskANN
- Container Apps Environment + Functions app
- Azure Bot Service + Teams channel
- AI Foundry models (global frontier default; EU DataZoneStandard when `euResidencyMode=true`)
- App Insights + Log Analytics

Key parameter (propagated everywhere):
```bicep
param euResidencyMode bool = false   // ← default = global frontier performance
```

Changing this flag and pushing to `main` automatically switches the entire LLM, embeddings, memory, and routing layer.

### Docker & Container Apps Flow

- Multi-stage Dockerfile (Node 22)
- Image pushed to personal ACR
- Container Apps revision updated automatically (zero-downtime)
- SkillForge base image is rebuilt and synced in the same pipeline when dev tooling changes

Health check runs immediately after deployment. If it fails, the pipeline aborts.

### Teams App Package

The `teams-package.yml` workflow:
- Substitutes `{{BOT_APP_ID}}` from `vars.BOT_APP_ID` (set by `deploy-router.yml`)
- Substitutes `{{TAB_HOST_URL}}` and `{{TAB_HOST_DOMAIN}}` from `vars.TAB_HOST_URL` (set by `deploy-tabs.yml`)
- Produces a clean zip with manifest + icons
- The generated zip must still be uploaded manually to your personal Teams catalog (as of March 2026; no full API publish path exists yet)

> **Build-time substitution:** The manifest source always carries `{{BOT_APP_ID}}`, `{{TAB_HOST_URL}}`, and `{{TAB_HOST_DOMAIN}}` as placeholders. `teams-package.yml` does the substitution at build time. This means the committed `manifest.json` always works as a valid starting point — `BOT_APP_ID` is set by the first router deployment, `TAB_HOST_URL` is set after Phase 2.5 tabs deployment.

### One-Time Bootstrap (Run Once Locally)

```powershell
az deployment group create `
  --resource-group helkinswarm-rg-prod-weu `
  --template-file infra/main.bicep `
  --parameters euResidencyMode=false
```

After this single command, everything else is handled by `git push main`.

### Integration with Modularity & SkillForge

- The CD pipeline automatically hot-reloads the capability loader (0a) after SkillForge PR merges.
- SkillForge base image is kept in sync so ephemeral containers always have the latest tooling.

### What NOT to Do

- ❌ Never deploy or update any resource manually in the Azure portal
- ❌ Never store secrets in GitHub secrets, .env, or Bicep — everything comes from Key Vault
- ❌ Never run `az containerapp update` manually
- ❌ Never upload the Teams app package without first running the official script (the zip must still be uploaded manually for now)
