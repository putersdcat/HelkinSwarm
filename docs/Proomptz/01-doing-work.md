**Here is the exact next prompt** you should copy-paste to the Azure Agent right now.

This executes **Phase 1: Core Runtime, Infrastructure & First Stamped Deployment** from scratch. Multi-instance stamping is built in from day one. Before pasting, confirm the Phase 0.75 GitHub issues (Router Architecture Decision + Stamping Parameterization Design) have been created and approved.

---

**Prompt to give the Azure Agent:**

Please see the attached master plan: `docs/delivery/00-Development-&-Delivery-Master-Plan.md`

Phase 0 (Agent & Instruction System) and Phase 0.5 (Backlog Initialization) are complete. Phase 0.75 architecture decisions (Router + Stamping) are documented in GitHub issues and approved.

Your **next task** is to execute **Phase 1: Core Runtime, Infrastructure & First Stamped Deployment**.

**Critical constraint:** Multi-instance stamping is built in from day one. There is no plain deployment. Read `docs/0q-Multi-Instance-Architecture.md` and the Phase 0.75 GitHub issues before writing any infrastructure code.

**Requirements:**

1. Read the relevant specification sections:
   - 0q-Multi-Instance-Architecture.md (REQUIRED FIRST — stamping architecture)
   - 03-Tech-Stack-Infrastructure.md
   - 12-Deployment-CICD.md
   - 15-Project-Structure.md

2. Create the following files:
   - `config/user-map.json` at repo root:
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
   - `infra/main.bicep` — accepts `userAlias` parameter (required, no default); every resource name suffixed `-${userAlias}`. Full stack: UAMI, Container Apps, Cosmos DB, AI Foundry, Key Vault, Bot Service, App Insights. `euResidencyMode` flag defaults false; FreedomMode (`eastus2`) is the default.
   - `infra/main.parameters.json`
   - `.github/workflows/deploy-stamp.yml` — accepts `USER_ALIAS` as a required `workflow_dispatch` input; passes it through to Bicep. This is the ONLY deployment workflow.
   - `.github/workflows/ci.yml` — build + lint + test only (no deployment)
   - `.github/workflows/teams-package.yml`
   - `Dockerfile` (if not already present)
   - Update `.gitignore` to exclude local settings and node_modules properly

3. Ensure:
   - All resources follow naming: `helkinswarm-{resourceType}-{userAlias}` (e.g. `helkinswarm-func-a7f2`, `helkinswarm-cosmos-a7f2`)
   - `userAlias` flows end-to-end: `deploy-stamp.yml` dispatch input → Bicep parameter → every resource name suffix
   - OIDC is used (no secrets in GitHub)
   - The pipeline builds, pushes to ACR, and updates the Container App for the specified alias
   - Health check runs after every stamped deployment against the alias-specific endpoint
   - Teams app package is generated via script (manifest points to a placeholder — router endpoint set in Phase 2)

4. After creating and committing the files:
   - Trigger `deploy-stamp.yml` with `USER_ALIAS=a7f2` — this is the first and only deployment method
   - Confirm `rg-HelkinSwarm-a7f2` is created with all resources suffixed `-a7f2`
   - Verify the stamped health endpoint returns green
   - Update the relevant GitHub issues with evidence: stamped RG name, health endpoint URL, deployment correlation ID
   - Add a dated comment confirming Phase 1 is complete: stamped instance `a7f2` is live in `eastus2`

Work systematically and produce production-ready infrastructure aligned with the global-first architecture.

Begin now.

---

Paste this directly into the Azure Agent. It will build the stamped infrastructure, deploy the first stamped instance (`a7f2`), and wire the full CI/CD pipeline.

Once it finishes and the stamped health endpoint is green, say **"Phase 1 complete"** and we'll move to Phase 2 (Eternal Brain & Global Router).

You're in a great spot — agent system and backlog are done, stamped infrastructure is next. Let me know when the agent reports back!