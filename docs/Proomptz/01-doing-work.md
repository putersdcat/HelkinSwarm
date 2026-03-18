**Here is the exact next prompt** you should copy-paste to the Azure Agent right now.

It continues directly from where the agent left off (Phase 1 complete) and moves to **Phase 0 completion** — the Bicep infrastructure + CI/CD pipelines — so the bot becomes live in your personal tenant and the Teams Test Harness can actually run against a real endpoint.

---

**Prompt to give the Azure Agent:**

Please see the attached master plan: `docs/delivery/00-Development-&-Delivery-Master-Plan.md`

Phase 1 (Core Runtime & Teams Interface) is complete (commit 28d55dc). All bot files compile and lint clean.

Your **next task** is to complete **Phase 0: Bootstrap** by creating the missing infrastructure foundation and CI/CD pipelines.

**Requirements:**

1. Read the relevant specification sections:
   - 03-Tech-Stack-Infrastructure.md
   - 12-Deployment-CICD.md
   - 15-Project-Structure.md

2. Create the following files:
   - `infra/main.bicep` (full desired-state deployment with UAMI, Container Apps, Cosmos DB, AI Foundry, Key Vault, Bot Service, App Insights, and `euResidencyMode` toggle)
   - `infra/main.parameters.json`
   - `.github/workflows/ci.yml`
   - `.github/workflows/cd.yml`
   - `.github/workflows/teams-package.yml`
   - `Dockerfile` (if not already perfect)
   - Update `.gitignore` to exclude local settings and node_modules properly

3. Ensure:
   - All resources use your personal tenant naming convention
   - OIDC is used (no secrets in GitHub)
   - The pipeline automatically builds, pushes to ACR, and updates the Container App
   - Health check runs after every deployment
   - Teams app package is generated via script

4. After creating and committing the files:
   - Run the one-time bootstrap command (az deployment group create) if needed
   - Push to main so the full CD pipeline executes
   - Verify the health endpoint returns green
   - Update the relevant GitHub issues (including the master plan issue) with evidence and correlation IDs
   - Add a dated comment confirming Phase 0 is now complete and the bot is live in the tenant

Work systematically and produce production-ready infrastructure aligned with the global-first architecture.

Begin now.

---

Paste this directly into the Azure Agent. It will build the missing infrastructure and CI/CD pieces, deploy them, and tie everything back to the master plan.

Once it finishes and pushes (you’ll see the health endpoint go green), say **“Phase 0 complete”** and we’ll move to Phase 2 (Eternal Overseer).

You’re in a great spot — Phase 1 is done, infrastructure is next. Let me know when the agent reports back!