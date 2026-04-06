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
| `deploy-router.yml` | push on router-affecting files + `workflow_dispatch` | Deploys the Global Teams Router to `rg-HelkinSwarm-router` and reasserts its guarded cost posture |
| `deploy-tabs.yml` | push on tab-host files + `workflow_dispatch` | Deploys the Global Tab Host to `rg-HelkinSwarm-tabs` and reasserts its guarded low-cost posture |
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

## Temporary Developer IP Allowlisting (`#212` groundwork)
- `deploy-stamp.yml` exposes optional workflow input `DEVELOPER_ALLOWED_IP_CIDRS`
- Value must be a JSON array string, for example: `["203.0.113.10/32"]`
- Current Phase 1 behavior records the intended debug CIDRs in Bicep/deployment outputs and workflow summaries without enforcing deny-by-default network ACLs yet
- Full enforcement still requires the later VNet/private-endpoint migration; do **not** claim the stamp is firewall-hardened just because debug CIDRs were supplied
- When temporary debug CIDRs are used, remove them again on the next dispatch once the investigation window is over

## Always
- ✅ Trigger `deploy-stamp.yml` with an explicit `USER_ALIAS` every time
- ✅ Pass `DEVELOPER_ALLOWED_IP_CIDRS` only as temporary JSON CIDR arrays when a debug window is truly needed
- ✅ Use OIDC federation for all Azure auth in workflows
- ✅ Run `pnpm lint && pnpm build` (ci.yml) before any merge
- ✅ Run `az bicep build` validation before any infra change
- ✅ Mark any new workflow with `# [REFACTOR-BEFORE-FIRST-RUN]` if not yet tested end-to-end
- ✅ Preserve the furious-development-phase cost guard from `#579` / `#580`: stamp + router deploys must keep paid observability off by default, tabs must remain storage-only, all three RG budgets must stay present, and workflows must fail if the guarded Azure state drifts unexpectedly

## Never
- ❌ Do NOT Deploy via Azure portal or ad-hoc `az` commands (one-time bootstrap excepted)
- ❌ Do NOT Store any secret (token, key, password) in GitHub secrets, `.env`, or Bicep
- ❌ Do NOT Treat `DEVELOPER_ALLOWED_IP_CIDRS` as permanent policy — it is for temporary debug windows only
- ❌ Do NOT Run `az containerapp update` manually
- ❌ Do NOT Add a `cd.yml` general-purpose deploy workflow — all deploys are stamped
- ❌ Do NOT Upload Teams app package without running `teams-package.yml` first
- ❌ Do NOT Re-enable stamp/router Log Analytics / App Insights / query alerts by default, do NOT add monitor resources to the tab-host RG, and do NOT weaken the `earlyDevCostGuard` / budget / post-deploy assertions, until the owner explicitly authorizes the end of the furious development phase

*We are the bridge.*
