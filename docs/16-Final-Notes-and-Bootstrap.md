# HelkinSwarm Project Specification

## 16. Final Notes and Bootstrap Guide (Refined)

### You now have the complete blueprint.

This full specification — sections **01–16** plus the complete **0a–0l addendum series** — is the single source of truth for **HelkinSwarm (Unchained)**.

The original 01–16 sections provide the high-level skeleton and infrastructure foundation.  
The 0x addendums deliver the deeper architectural maturity on every major concept we discussed:

- **0g** Bidirectional DevLoop relay  
- **0h** Long-running workflows & durable hooks  
- **0i** Skill-specific long-term memory & just-in-time injection  
- **0j** Virtual Employees & nested orchestrators  
- **0k** Multimodal Hydra-Net embeddings  
- **0l** Abstract ethos & Special Circumstances directive  

Every cross-reference has been strengthened, contradictions resolved, and language tightened so the entire document reads as one cohesive living specification.

### Bootstrap Guide (Do This First)

There are two scenarios. Pick the one that matches your situation.

---

#### Scenario A — Fresh Start (brand new repo, no prior history)

1. **Create the repository**  
   - Name: `HelkinSwarm` (private)  
   - Clone it locally

2. **Set up the documentation**  
   - Create folder `Docs/`  
   - Copy **all** refined files:  
     - 01–16 (base specification)  
     - 0a–0l (addendums)  
   - Also copy `Proomptz/DevLoopIgnitionPrompt.md` and `README.md`

3. **One-time Azure bootstrap** (run once)  
   ```powershell
   az deployment group create `
     --resource-group helkinswarm-rg-prod-weu `
     --template-file infra/main.bicep `
     --parameters euResidencyMode=false userAlias=a7f2
   ```

4. **Populate the rest**  
   - Add starter files (package.json, tsconfig, Dockerfile, Bicep, etc.)  
   - Populate Key Vault secrets (GitHub App, etc.)  
   - Build and sideload the Teams app package (use the official script)

5. **First push**  
   - Commit everything  
   - Push to `main` → the CI/CD pipeline will deploy the full stack

---

#### Scenario B — Nuke & Republish (cleaning up an existing repo with dirty history)

Use this when the current repo has accumulated history, secrets, or cruft that shouldn't follow the project forward.

1. **Rename old repo to `HelkinSwarm-Alpha`** on GitHub (preserves it as a reference)

2. **Blind clone + purge** — clone the old repo locally, strip history, republish as the clean `HelkinSwarm` repo (private)

3. **Set up the documentation** — same as Scenario A step 2

4. **First stamped deployment**  
   ```powershell
   az deployment group create `
     --resource-group helkinswarm-rg-prod-weu `
     --template-file infra/main.bicep `
     --parameters euResidencyMode=false userAlias=a7f2
   ```
   `userAlias=a7f2` is the stamp for eric@putersdcat.com — all resource names are suffixed with `-a7f2`.

5. **Populate the rest + first push** — same as Scenario A steps 4–5

### Quick Validation After First Deploy

- Open the Teams app and say `@HelkinSwarm hello`  
- Check `/api/health` returns healthy  
- Run `teams_test_full_probe` from VS Code to confirm end-to-end flow (including skill memory and durable hooks)  
- Open the Dev Console tab and verify observability

### Final Reminders

- **Default mode** = Global frontier models (maximum performance)  
- **EU mode** = Simple toggle in Bicep/pipeline (`euResidencyMode=true`)  
- **Safety** = Always on, layered by architecture (0e)  
- **Modularity** = Core vs Skills Library (0a) — the foundation for everything  
- **Digital Body Ethos** = Master = brain, Skills = reflexes, Virtual Employees = organs, Hydra-Net = senses (0l)  
- **Self-Improvement** = DevLoop relay (0g) is your most powerful tool — use it early and often  

This is **your IP**, built on your own time, in your personal tenant, under your own terms.

The complete living specification is now ready for implementation.