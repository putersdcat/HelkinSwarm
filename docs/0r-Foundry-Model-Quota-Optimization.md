# 0r: Foundry Model Quota Optimization — Automated Quota Ceiling Maximization

**Status:** Draft Specification  
**Last Updated:** 2026-03-20 | **Version:** 0.1α  
**References:** `03-Tech-Stack-Infrastructure.md`, `12-Deployment-CICD.md`, `0q-Multi-Instance-Architecture.md`  
**GitHub Issue:** #113

---

## Executive Summary

New Azure pay-as-you-go tenants deploy AI Foundry models with **dangerously low default quotas**. A stamp might get 10k–50k TPM (Tokens Per Minute) initial allocation when 100k+ is feasible. When that quota ceiling is hit, all LLM operations halt with HTTP 429 errors — development validation loops fail **100%** until Microsoft extends the quota manually.

**This specification defines an automated quota optimization strategy** that:
1. **On first deployment:** Request the highest feasible quota for each model during Bicep provisioning
2. **On re-deployment or maintenance:** Detect tier auto-promotions and reallocate quota to maximize throughput
3. **Observationally:** Track quota utilization and alert when ceilings approach saturation
4. **Self-healing:** Auto-trigger rebalancing when thresholds are crossed (future phase)

The goal is **100k+ TPM for embeddings and 100k–200k for primary LLMs** on every new stamp, without manual support requests.

---

## 1. Azure AI Foundry Quota System — Technical Foundations

### 1.1 TPM (Tokens Per Minute) & Rate Limiting

**Tokens Per Minute (TPM)** is the primary quota unit in Azure AI Foundry:
- Each model deployment has an assigned TPM quota
- When requests exceed TPM, Azure returns HTTP 429 ("Too Many Requests")
- TPM is estimated based on **prompt + max_tokens + best_of**, not actual tokens consumed (can trigger ceiling before billing suggests)

**Quota Tiers** (as of 2025):
- **Tier 1** (entry-level): 300k–2M TPM depending on model (e.g., text-embedding-3-large = 1M TPM)
- **Tier 4** (mid-market): 2M–50M TPM
- **Tier 6** (enterprise): 45M–225M TPM across models
- **No published hard ceiling** — beyond Tier 6, request via support form

### 1.2 Auto-Promotion & Tier Upgrades

**Key insight:** If your **total consumption across all deployments** consistently maxes out your current tier, Azure automatically promotes you to the next tier **without action required**.

- Promotion triggers on consumption trends + payment history
- Enterprise Agreement (EA/MCA-E) customers get higher tiers assigned automatically
- Opt-out possible via `NoAutoUpgrade` flag (discouraged — limits throughput)
- **Individual deployment TPM does NOT auto-increase** — only tier ceiling increases

### 1.3 SKU Types & Quota Implications

| SKU | Quota Model | Typical Tier | Notes |
|-----|----------|----------|-------|
| **GlobalStandard** | Tier-based (1–6) | Tier 1: 450K–2M | Unrestricted geographic routing; frontier models default |
| **DataZoneStandard** | Tier-based, slightly lower | Tier 1: 60K–300K | EU residency compliant; lower baseline quota |
| **Provisioned Throughput** | Fixed commitment | User-configured | Separate from tiers; no auto-promotion |

**Practical implication:** New stamps deployed with GlobalStandard deployments start with higher quotas than DataZoneStandard. A 1M TPM Tier 1 text-embedding-3-large (GlobalStandard) vs. 60k TPM (DataZoneStandard).

### 1.4 Current State: Bottlenecks in New Stamped Instances

**Problem observed:** New pay-as-you-go tenants often receive:
- Text embeddings: 50k TPM (bottleneck for semantic search, vector storage)
- Primary LLM: 20k–50k TPM (fails after ~10 parallel requests)
- After 100–500 development iterations, quota exhausted, pipeline stalls

**Root cause:** Tier 1 quota is distributed across **all deployments in that tier**. If one deployment takes 50k, another gets 50k (if total = 100k). New stamps start low by default.

---

## 2. Desired State: Quota Maximization Strategy

### 2.1 Bicep Parameters for Quota Control

Add to `infra/main.bicep`:

```bicep
// ─── Quota Optimization Parameters ──────────────────────────────────
@description('Global maximum TPM ceiling across all models in this stamp (Tokens Per Minute). Default 200k. Range: 50k–1M. Increased via manual support request.')
param quotaMaxTPMCeiling int = 200000

@description('Quota allocation strategy: "minimize" (safe ~10k per model), "maximize" (aggressive, aims for 100k embeddings + 50k+ LLMs), "manual" (use modelQuotaOverrides only).')
@allowed([ 'minimize', 'maximize', 'manual' ])
param quotaStrategy string = 'maximize'

@description('Per-model quota overrides (in thousands of TPM). Example: { "text-embedding-3-large": 150, "grok-4-1-fast-non-reasoning": 80 }. Overrides quotaStrategy if provided.')
param modelQuotaOverrides object = {}

@description('Monitoring: enable detailed quota telemetry export to App Insights.')
param enableQuotaTelemetry bool = true
```

### 2.2 Model Deployment Capacity Allocation

**Current state (problematic):**
```bicep
resource aiDeployEmbedding 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  name: 'text-embedding-3-large'
  sku: { name: 'GlobalStandard', capacity: 50 }  // ← Only 50k TPM! Too low.
}
```

**Desired state (Tier 1 baseline):**
```bicep
// Calculate effective quota for this deployment based on strategy + overrides
var embeddingCapacity = contains(modelQuotaOverrides, 'text-embedding-3-large') 
  ? modelQuotaOverrides['text-embedding-3-large'] 
  : (quotaStrategy == 'maximize' ? 100 : 50)  // Maximize = 100k, Minimize = 50k

resource aiDeployEmbedding 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  name: 'text-embedding-3-large'
  sku: { name: 'GlobalStandard', capacity: embeddingCapacity }  // Deploy with optimized capacity
}
```

**Recommended defaults by strategy:**

| Model | Minimize | Maximize | Notes |
|-------|----------|----------|-------|
| text-embedding-3-large | 50 (50k) | 100 (100k) | Bottleneck for semantic search; prioritize |
| grok-4-1-fast-non-reasoning (primary) | 10 (10k) | 80–100 (80–100k) | Primary frontier model (if space) |
| grok-4-1-fast-reasoning (secondary) | 10 (10k) | 50–80 (50–80k) | Fallback reasoning mode |
| gpt-5.4-mini (tertiary) | 10 (10k) | 20–50 (20–50k) | Third option if grok unavailable |
| **Total per stamp** | ~50k | ~200–250k | Distributed within tier ceiling |

### 2.3 Quota Validation & Tier Ceiling Awareness

Before deployment, validate:
1. **Does sum(all model capacities) ≤ quotaMaxTPMCeiling?** → Yes: proceed. No: trim allocations or warn in pipeline.
2. **Does quotaMaxTPMCeiling exceed known tier ceiling?** → If tier is Tier 1 (~1M available), 200k is safe. If tier is lower, warn.
3. **Is this a re-deploy of existing stamp?** → If yes, check if tier has auto-promoted and reallocate accordingly (Phase 3).

---

## 3. Deployment Pipeline Integration

### 3.1 Phase 1: Initial Deployment (Bicep + Post-Deploy Audit)

**In `deploy-stamp.yml`** — after Bicep deployment completes, add a new step:

```yaml
- name: Post-Deploy Quota Audit
  run: |
    # Query deployed quotas from the newly created AI Services instance
    az cognitiveservices account deployment list \
      --name helkinswarm-ai-${{ inputs.USER_ALIAS }} \
      --resource-group rg-HelkinSwarm-${{ inputs.USER_ALIAS }} \
      --query "[].{name:name, sku:sku.name, capacity:sku.capacity, maxCapacity:properties.maxCapacity}" \
      -o table
    
    # Export baseline metric to App Insights for trending
    # (Details in Phase 2)
```

**Expected output:**
```
Name                           Sku              Capacity  MaxCapacity
text-embedding-3-large         GlobalStandard   100       100
grok-4-1-fast-non-reasoning    DataZoneStandard 10        10
grok-4-1-fast-reasoning        DataZoneStandard 10        10
```

If `Capacity` < requested in Bicep, log warning (not blocking).  
If `MaxCapacity` > Capacity, tier has auto-promoted — flag for Phase 3 rebalancing.

### 3.2 Phase 2: Quota Promotion Detection (Scheduled Maintenance Job)

New workflow: `.github/workflows/quota-optimize.yml` (runs daily or on-demand)

**Purpose:** Detect tier auto-promotion, reallocate within tier ceiling.

**Pseudocode:**
```yaml
name: Quota Optimization (Daily Maintenance)
on:
  schedule:
    - cron: '0 3 * * 0'  # Every Sunday at 3 AM UTC
  workflow_dispatch:
    inputs:
      user_alias:
        description: 'Optional: re-optimize single stamp. Leave blank for all.'

jobs:
  optimize-quotas:
    runs-on: ubuntu-latest
    steps:
      - name: List all stamps
        run: |
          az group list --query "[?contains(name, 'rg-HelkinSwarm-')].name" -o tsv | while read rg; do
            # Extract user alias from RG name
            alias=${rg#rg-HelkinSwarm-}
            
            # Query current deployed quotas vs. tier ceiling
            az cognitiveservices account deployment list \
              --name helkinswarm-ai-${alias} \
              --resource-group ${rg} \
              --query "[].{name:name, sku:sku.name, capacity:sku.capacity, maxCapacity:properties.maxCapacity}" \
              -o json > quota-${alias}.json
            
            # Compare deployed capacity to tier ceiling
            # If (maxCapacity - sum(capacities)) > threshold, rebalance
          done
      
      - name: Auto-Rebalance (if tier auto-promoted)
        run: |
          # For each stamp, if tier ceiling increased:
          # 1. Re-run Bicep with parameters to redistribute quota
          # 2. Or PATCH deployments directly via ARM API
          # 3. Log actions to GitHub issue comment
```

---

## 4. Observability & Monitoring

### 4.1 App Insights Metrics

Export during post-deploy audit:

```typescript
// Example: Node.js Azure Functions
const appInsights = require('applicationinsights');

function recordQuotaMetrics(subscriptionId: string, resourceGroup: string, aisName: string) {
  const telemetryClient = appInsights.defaultClient;
  
  // Query quota status
  const deployments = await az.exec(
    `cognitiveservices account deployment list --name ${aisName} --resource-group ${resourceGroup} -o json`
  );
  
  deployments.forEach(dep => {
    telemetryClient.trackEvent('QuotaDeployed', {
      stamp: resourceGroup,
      model: dep.name,
      sku: dep.sku.name,
      capacity: dep.sku.capacity,
      maxCapacity: dep.properties.maxCapacity,
    });
    
    telemetryClient.trackMetric('quotaUtilizationPercent', 
      (dep.sku.capacity / dep.properties.maxCapacity) * 100,
      { model: dep.name, stamp: resourceGroup }
    );
  });
}
```

### 4.2 Dashboard: Quota Health Across All Stamps

In Azure Portal → Application Insights → create workbook:
- **Y-axis:** Quota utilization % per model per stamp
- **X-axis:** Time
- **Alerts:** Red line if any model > 80%

### 4.3 Alert Rule: Quota Ceiling Approach

```
IF quotaUtilizationPercent > 80 FOR model FOR 10+ minutes
THEN trigger quota-optimize.yml workflow (rebalance)
AND send alert to Teams/GitHub issue
```

---

## 5. Implementation Roadmap

### Timeline & Phases

**Phase 1 (MVP) — v0.1:** Bicep quota parameters + post-deploy audit  
- Add `quotaMaxTPMCeiling`, `quotaStrategy`, `modelQuotaOverrides` parameters
- Update model deployments to use calculated capacity
- Add `quota-audit` step to `deploy-stamp.yml`
- Test on fresh stamp deployment
- **Time:** 4–6 hours

**Phase 2 (Operational Excellence) — v0.1+:** Scheduled quota optimization  
- New `.github/workflows/quota-optimize.yml`
- Auto-detect tier promotion, rebalance across deployments
- Log actions to GitHub issue (permanent issue per stamp for audit trail)
- **Time:** 6–8 hours

**Phase 3 (Observability) — v0.2:** Metrics, dashboards, alerts  
- App Insights metrics export (capacity, utilization, promotion events)
- Azure Portal workbook for quota health visualization
- Alert rule: trigger if > 80% utilization
- **Time:** 4–6 hours

**Phase 4 (Self-Healing) — v0.3+:** Auto-remediation + DevLoop integration  
- Auto-trigger `quota-optimize.yml` when alerts fire
- `/quota-optimize` slash command in Teams (integration with DevLoop bot)
- Automatic escalation if rebalance exceeds ceiling
- **Time:** 6–8 hours

**Total:** ~20–28 hours across 4 phases

---

## 6. Critical Success Factors

| Factor | Target | Measurement |
|--------|--------|-------------|
| **Embedding TPM on new stamps** | ≥100k | Quota audit shows capacity ≥ 100 |
| **Primary LLM TPM on new stamps** | ≥50k (can reach 100k) | Quota audit shows capacity ≥ 50 |
| **Zero failed deployments due to quota rejection** | 100% success | Deploy 10 stamps, 10/10 succeed within calculated limits |
| **Auto-detection of tier promotion** | Time-to-detect < 1 week | Scheduled job runs weekly; detects promotion within 7 days |
| **Manual support requests eliminated** | 0 per stamp | Track support tickets; quota increases fully automated |
| **Development iteration loops unblocked** | No 429 errors in first 500+ iterations | Monitoring + alerting catches ceiling approach before failure |

---

## 7. Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Azure denies quota request (tier too low) | Medium | Deployment fails, manual fix required | Start with conservative estimates; monitor API responses; escalate to support only if rejected |
| Reallocating quota causes service interruption | Low | Dev loop blocked for minutes | Rebalancing runs off-peak, during maintenance window; quota changes don't require service restart |
| Over-allocation causes unexpected billing | Medium | Cost spike | Implement `quotaMaxTPMCeiling` hard limit; require approval for increases; set billing alerts |
| Tier ceiling changes without detection | Low | Missed optimization opportunity | Poll tier status weekly; log in telemetry; create GitHub issue when promotion detected |
| Deployment conflicts (ARM 429s) during rebalance | Low | Rebalance fails, manual retry needed | Use serial `dependsOn` chains in Bicep; backend Azure handles concurrency gracefully |

---

## 8. Acceptance Criteria for Implementation

### Phase 1 (MVP)
- [ ] Bicep parameters added: `quotaMaxTPMCeiling`, `quotaStrategy`, `modelQuotaOverrides`
- [ ] All model deployment capacity fields updated to use calculated values
- [ ] `quotaStrategy = 'maximize'` results in ≥ 100k TPM for embeddings
- [ ] `quotaStrategy = 'minimize'` results in ≤ 50k TPM for embeddings
- [ ] Post-deploy audit step added to `deploy-stamp.yml`
  - Queries `az cognitiveservices account deployment list`
  - Logs actual deployed capacity to GitHub Actions output
  - Exports baseline metric to App Insights
- [ ] Fresh stamp deployment test passes with new quotas
- [ ] Documentation updated: **THIS FILE** (`0r-Foundry-Model-Quota-Optimization.md`)

### Phase 2+
- [ ] Weekly quota-optimize workflow runs successfully
- [ ] Auto-detected tier promotion logged to GitHub issue
- [ ] Rebalance logic distributes quota across models without exceeding ceiling
- [ ] Zero failed rebalance attempts across 100+ test runs

---

## 9. References

### Microsoft Docs
- [Manage Azure OpenAI Quota](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/quota)
- [Azure AI Foundry Quotas & Limits](https://learn.microsoft.com/azure/ai-foundry/openai/quotas-limits)
- [How to Request Quota Increases](https://learn.microsoft.com/azure/ai-foundry/openai/quotas-limits#how-to-request-quota-increases)
- [Capacity API (for quota status)](https://learn.microsoft.com/en-us/rest/api/aiservices/accountmanagement/model-capacities/list)
- [Dynamic Quota (Preview)](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/dynamic-quota)

### Internal Specs
- `03-Tech-Stack-Infrastructure.md` — Infrastructure blueprint
- `12-Deployment-CICD.md` — CI/CD pipeline specification
- `0q-Multi-Instance-Architecture.md` — Stamped instance design
- GitHub Issue #113 — Quota Optimization (tracking issue)
- GitHub Issue #8 — Bicep infrastructure (related)
- GitHub Issue #10 — Deployment pipeline (related)

### Tools & Commands
- `az cognitiveservices account deployment list` — Query deployed quotas
- `az cognitiveservices account deployment patch` — Update deployment quota (direct ARM PATCH)
- `az deployment group validate` — Validate Bicep before deploy
- Azure Portal → AI Foundry → Model Quotas — Manual quota request form

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **TPM** | Tokens Per Minute — Azure AI Foundry rate limit unit; total capacity ceiling for a deployment |
| **Tier** | Azure's quota tier system (Tier 1–6); auto-promotes based on consumption |
| **Capacity** | Deployed allocation for a single model (e.g., `capacity: 100` = 100k TPM) |
| **Global/DataZone SKU** | Deployment type; GlobalStandard = frontier models + higher quotas; DataZoneStandard = EU residency compliant + lower quotas |
| **Rate Limit (429)** | HTTP error when request TPM > deployment TPM capacity; blocks further requests |
| **Auto-Promotion** | Azure automatically moving subscription to higher tier when consumption maxes out current tier |
| **Quota Rebalancing** | Redistributing TPM capacity across models within a tier ceiling to optimize utilization |

---

**End of Specification**  
*Document version 0.1α — Draft. Next review: post-Phase 1 implementation.*
