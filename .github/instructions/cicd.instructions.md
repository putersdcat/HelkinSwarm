---
applyTo: ".github/workflows/**,infra/**,Dockerfile"
---

# CI/CD Rules
**Spec ref:** `docs/12-Deployment-CICD.md`, `docs/03-Tech-Stack-Infrastructure.md`, `docs/0q-Multi-Instance-Architecture.md`

## Critical Rule
`git push main` is the **only** deployment mechanism. Never deploy resources manually from the portal or command line except for the one-time initial bootstrap. All infrastructure is desired-state Bicep — one file, one source of truth.

## Multi-Instance Stamping (Built-In From Day 1)
Every deployment targets a specific **user stamp** (`userAlias`). There is no un-stamped deployment path.

- `userAlias` convention: 4-character lowercase hex (e.g. `a7f2`)
- Resource naming: `helkinswarm-{resourceType}-{userAlias}` (e.g. `helkinswarm-func-a7f2`)
- Resource group: `rg-HelkinSwarm-{userAlias}` (e.g. `rg-HelkinSwarm-a7f2`)
- User-to-alias map: `config/user-map.json` (source-controlled, no secrets)

## Workflows

| Workflow | Trigger | What It Does |
|----------|---------|--------------|
| `ci.yml` | Every push + PR | Lint, TypeScript compile, type-check, Bicep validation |
| `deploy-stamp.yml` | `workflow_dispatch` with `USER_ALIAS` input | Full Bicep deploy + Docker build + ACR push + Container Apps update for the specified alias |
| `deploy-router.yml` | `workflow_dispatch` | Deploys the Global Teams Router to `rg-HelkinSwarm-router` |
| `teams-package.yml` | Manual dispatch | Builds the Teams app zip; must still be uploaded manually |

**`cd.yml` does NOT exist.** Deployment is always stamped via `deploy-stamp.yml`.

## Bicep (`infra/main.bicep`)
- `userAlias` parameter — **required, no default** — passed from `deploy-stamp.yml`
- `euResidencyMode bool = false` — global frontier default; EU DataZoneStandard when `true`
- Every resource name suffixed with `-${userAlias}`
- All secrets auto-loaded from Key Vault; none in Bicep parameters

## Router (`infra/main-router.bicep`)
- Separate Bicep for the Global Teams Router
- Deployed independently to `rg-HelkinSwarm-router` — never mixed with user stamps

## Authentication
- OIDC federation — no secrets stored in GitHub Actions secrets
- Service principal: `HelkinSwarm-CICD` with Federated Credential for the repo's `main` branch

## Health Check
- Runs automatically after every stamped deployment
- Target: `https://helkinswarm-func-{alias}.azurecontainerapps.io/api/health`
- Pipeline aborts if health check fails

## Always
- ✅ Trigger `deploy-stamp.yml` with an explicit `USER_ALIAS` every time
- ✅ Use OIDC federation for all Azure auth in workflows
- ✅ Run `pnpm lint && pnpm build` (ci.yml) before any merge
- ✅ Run `az bicep build` validation before any infra change
- ✅ Mark any new workflow with `# [REFACTOR-BEFORE-FIRST-RUN]` if not yet tested end-to-end

## Never
- ❌ Deploy via Azure portal or ad-hoc `az` commands (one-time bootstrap excepted)
- ❌ Store any secret (token, key, password) in GitHub secrets, `.env`, or Bicep
- ❌ Run `az containerapp update` manually
- ❌ Add a `cd.yml` general-purpose deploy workflow — all deploys are stamped
- ❌ Upload Teams app package without running `teams-package.yml` first

*We are the bridge.*
