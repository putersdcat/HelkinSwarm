# HelkinSwarm Project Specification

## 12. Deployment & CI/CD (Refined)

### Overview

The entire HelkinSwarm stack is **100% GitOps-driven**. Every change — infrastructure, code, models, SkillForge base image, or Teams app package — is deployed automatically on `git push main`. There are **no manual portal clicks** after the very first resource group creation.

The pipeline is intentionally simple, observable, and safe for a personal project that may later become open-source or commercial.

### GitHub Actions Workflows

| Workflow              | Trigger                  | What It Does |
|-----------------------|--------------------------|--------------|
| `ci.yml`              | Every push + PR          | Lint, TypeScript compile, type-check, Bicep validation |
| `deploy-stamp.yml`    | Push to `main` + manual dispatch | Stamped Bicep deploy → Docker build → ACR push → Container Apps update + post-deploy guardrail assertions |
| `deploy-router.yml`   | Push to `main` on router-affecting files + manual dispatch | Deploys the global router (rg-helkinswarm-router + Bot Service + Teams channel), reapplies the early-dev cost guard, and sets `BOT_APP_ID` / `ROUTER_UAMI_ID` GitHub variables. |
| `deploy-tabs.yml`     | Push to `main` on tab-host files + manual dispatch | Deploys the global tab SPA (rg-helkinswarm-tabs + Azure Storage static website) and reasserts the tab-host low-cost posture plus RG budget. |
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

Key parameters (propagated everywhere):
```bicep
param euResidencyMode bool = false   // ← default = global frontier performance
param lowCostDevMode bool = false     // ← reduces ingestion cap/sampling while keeping both the stamp and router warm for first-turn chat reliability (#303, #341, #393, #410)
param earlyDevCostGuard bool = true   // ← furious-development-phase cost lockdown; keeps paid observability off until owner authorizes removal (#579)
```

Changing `euResidencyMode` and pushing to `main` automatically switches the entire LLM, embeddings, memory, and routing layer. `lowCostDevMode` remains available for future non-off observability profiles, but **furious-development-phase production deploys are currently governed by `earlyDevCostGuard=true`**, which forces dirty-dev cost posture, deploys a resource-group budget, and fails the workflow if paid observability resources reappear.

### workflow_dispatch Inputs (`deploy-stamp.yml`)

| Input | Default | Description |
|-------|---------|-------------|
| `USER_ALIAS` | `vars.USER_ALIAS` | 4-char stamp alias |
| `QUOTA_STRATEGY` | `maximize` | AI deployment quota allocation |
| `QUOTA_MAX_TPM_CEILING` | `400000` | Max total TPM requested |
| `MODEL_QUOTA_OVERRIDES_JSON` | `''` | Per-model TPM overrides as JSON |
| `EU_RESIDENCY_MODE` | `false` | EU DataZoneStandard toggle |
| `CREATE_OAUTH_CONNECTION` | `false` | Recreate GraphOAuth Bot Service connection |
| `LOW_COST_DEV_MODE` | `false` | Activate Low Cost Dev Mode cost controls; both stamp and router stay warm while observability-cost knobs still apply (#303, #393, #410) |
| `DIRTY_DEV_MODE` | `false` | Disable paid Log Analytics/App Insights for the dev stamp (#382). While `earlyDevCostGuard=true`, workflow input cannot disable the enforced off posture. |

### Furious Development Phase Cost Lock (`#579`)

The stamped deployment pipeline now carries a **source-controlled early-dev cost lock** because manual dirty-dev toggles were not durable enough.

While this lock is active:
- push-triggered stamp deploys always run Bicep, even for code-only changes, so cost invariants are continuously re-asserted
- stamped Container Apps environments must use **no persisted logs**
- the current Azure-supported implementation of that posture is `azure-monitor` with **zero diagnostic settings** on the Container Apps environment
- stamp LAW/App Insights/query-alert resources must remain absent
- the Function App must not carry `APPLICATIONINSIGHTS_CONNECTION_STRING`
- a stamped RG budget of `$30/month` must exist

> ⛔ These controls are not to be removed, relaxed, or bypassed until the owner/human-in-the-loop explicitly authorizes the end of the furious development phase.

### Global Surface Cost Lock (`#580`)

The same durability rule now applies to the global router and tab host:

- router deploys reassert observability-off posture and a `$10/month` RG budget
- tab-host deploys reassert storage-only posture and a `$5/month` RG budget
- both workflows fail if their guarded Azure state drifts away from the intended furious-development-phase posture

This means the cost emergency controls are now **comprehensive across stamp + router + tabs**, not just the original user stamp.


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
