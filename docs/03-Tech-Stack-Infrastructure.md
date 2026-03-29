# HelkinSwarm Project Specification

## 3. Tech Stack & Infrastructure (Refined)

### Tech Stack Overview (Unchained Edition)

| Layer                  | Technology                                      | Default Mode (Global Frontier)          | EU Residency Mode (toggle) |
|------------------------|-------------------------------------------------|-----------------------------------------|----------------------------|
| **Language / Runtime** | TypeScript + Node.js 22 LTS                     | Global                                  | Global                     |
| **Bot Interface**      | Bot Framework SDK v4 + Teams channel            | Global                                  | Global                     |
| **Orchestration**      | Azure Durable Functions (eternal overseer)      | Global                                  | Global                     |
| **LLM Primary**        | Azure AI Foundry                                | Grok / GPT frontier models (Global Standard) | GPT-5 / o4-mini (DataZoneStandard EU) |
| **LLM Secondary**      | Azure AI Foundry                                | Grok fast / GPT variants                | o3 / gpt-5-mini (EU)       |
| **Embeddings**         | text-embedding-3-large + Hydra-Net router       | Global (0k)                             | EU endpoint                |
| **Memory**             | Cosmos DB Serverless + DiskANN                  | Global + skill-specific vaults (0i)     | EU DataZone                |
| **Hosting**            | Azure Functions v4 on Container Apps            | Global                                  | Global                     |
| **Auth**               | User-Assigned Managed Identity + scoped tokens  | Global                                  | Global                     |
| **IaC**                | Bicep (single source of truth)                  | Global                                  | Global                     |
| **CI/CD**              | GitHub Actions (OIDC)                           | Global                                  | Global                     |

**Unchained Principle (reinforced from 01 & 0a):**  
Global frontier models and infrastructure are the **default** for maximum performance. EU DataZoneStandard residency is a **single pipeline-configurable toggle** (`euResidencyMode`). When enabled, the entire stack (models, embeddings, memory, routing) automatically switches to EU-only endpoints and storage — no code changes required.

### Infrastructure (Bicep-Driven Desired State)

All Azure resources are defined in **`infra/main.bicep`**. Everything is deployed automatically on `git push main`. No manual portal work after initial bootstrap.

**Core Resources (personal tenant naming)**

| Resource                     | Name Example                          | Purpose |
|------------------------------|---------------------------------------|-------|
| Resource Group               | `helkinswarm-rg-prod-weu`             | Container for everything |
| User-Assigned Managed Identity | `helkinswarm-uami`                    | Root identity (no secrets) |
| Container Apps Environment   | `helkinswarm-cae-prod-weu`            | Hosts Functions app |
| Azure Functions App          | `helkinswarm-func-prod`               | Main runtime + SkillForge jobs |
| Azure Container Registry     | `helkinswarmacr`                      | Docker images (SkillForge base image) |
| Key Vault                    | `helkinswarm-kv`                      | All secrets & GitHub App key |
| Cosmos DB (Serverless)       | `helkinswarm-cosmos`                  | Sessions + multimodal memory + skill vaults (0i) |
| Azure AI Services (Foundry)  | `helkinswarm-ais`                     | LLM + Hydra-Net embeddings (0k) |
| Bot Service                  | `helkinswarm-bot`                     | Teams channel |
| Application Insights         | `helkinswarm-ai`                      | Full observability (13) |

### EU Residency Toggle (One Parameter Controls Everything)

```bicep
param euResidencyMode bool = false   // ← default = global frontier performance

resource aiServices 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'helkinswarm-ais'
  location: 'westeurope'
  kind: 'AIServices'
  sku: {
    name: euResidencyMode ? 'DataZoneStandard' : 'GlobalStandard'
  }
}
```

When `euResidencyMode = true`:
- All models switch to EU DataZoneStandard deployments
- Cosmos DB uses EU region + compliant config
- Embeddings, memory, and routing automatically follow
- Non-PII lane is disabled

### Model Deployments & Hydra-Net

Bicep creates and manages all model deployments. Default (Unchained) configuration:
- Primary: frontier global models
- Secondary: fast variants
- Embeddings: text-embedding-3-large + Hydra-Net router (0k) for text/image/speech

### Deployment Flow (Pure GitOps)

```mermaid
graph LR
    A[git push main] --> B[CI: lint + compile + Bicep validate]
    B --> C[CD: OIDC login to personal tenant]
    C --> D[Bicep deploy infra/main.bicep]
    D --> E[Docker build + push to ACR]
    E --> F[Container Apps update (new revision)]
    F --> G[Health check + SkillForge base image sync]
    G --> H[Teams app package ready for upload]
```

### Environment Variables (All from Key Vault or Bicep)

- `LLM_MODEL_PRIMARY` / `LLM_MODEL_SECONDARY`
- `AZURE_AI_FOUNDRY_ENDPOINT`
- `euResidencyMode`
- `COSMOS_ENDPOINT`
- `AZURE_CLIENT_ID` (UAMI)
- `SKILLFORGE_ENABLED`

No secrets or hard-coded strings anywhere in source.

### One-Time Bootstrap (Run Once)

```powershell
az deployment group create `
  --resource-group helkinswarm-rg-prod-weu `
  --template-file infra/main.bicep `
  --parameters euResidencyMode=false
```

After this single command, everything else is handled by `git push main`.

### Multi-Instance Stamping

All Bicep resources now accept `userAlias` parameter. Resource names are suffixed with `-{{userAlias}}`. Default for initial deployment: `a7f2` (eric@putersdcat.com).

### What NOT to Do

- ❌ Never deploy or update resources manually in the Azure portal
- ❌ Never store any secret in GitHub secrets, .env, or Bicep
- ❌ Never run `az containerapp update` manually
- ❌ Never upload the Teams app package without the official script (manual upload of the generated zip is still required as of March 2026)

### Runtime Environment Variables

Key environment variables set via Bicep and propagated to the Function App:

| Variable | Source | Description |
|----------|--------|-------------|
| `LLM_PRIMARY_MODEL` | Bicep param | Primary LLM model deployment name |
| `LLM_SECONDARY_MODEL` | Bicep param | Secondary LLM model |
| `EU_RESIDENCY_MODE` | Bicep param | EU DataZone toggle |
| `COSMOS_ENDPOINT` | Bicep | Cosmos DB URL (MSI auth) |
| `AZURE_CLIENT_ID` | Bicep | Stamp UAMI client ID |
| `MICROSOFT_APP_ID` | Bicep | Router UAMI client ID (bot identity) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Bicep | App Insights telemetry |
| `DEV_TELEMETRY_MODE` | Bicep param | `off\|minimal\|standard\|verbose` (default: `verbose`) |
| `OWNER_USER_ID` | Manual (Function App settings) | Azure AD object ID of the owner; drives RBAC role resolution (#248) |
| `MAINTENANCE_MODE` | Bicep | `true\|false` — disables bot if set |
| `SKILLFORGE_ENABLED` | Bicep | `true\|false` — enables SkillForge dynamic skill creation |

### Low Cost Dev Mode (`lowCostDevMode`, #303)

Added in #303 and corrected in #341. A single Bicep boolean param controls a bundle of cost-reduction settings designed for personal dev use.

Because HelkinSwarm uses a paid Log Analytics workspace plus workspace-based Application Insights, the original 7-day retention profile turned out to be deployment-invalid. Low Cost Dev Mode now keeps retention at the minimum valid 30 days and reduces cost through ingestion caps, sampling, minimal telemetry, and scale-to-zero.

| Setting | Normal | Low Cost Dev Mode |
|---------|--------|-------------------|
| Log Analytics retention | 30 days | 30 days (minimum valid on current paid tier) |
| App Insights retention | 30 days | 30 days (workspace-based minimum valid) |
| Log Analytics daily ingestion cap | unlimited | 0.1 GB/day |
| App Insights sampling | 100% | 10% (~90% ingestion reduction) |
| `DEV_TELEMETRY_MODE` override | from param | forced `minimal` |
| `minimumElasticInstanceCount` | 1 (always warm) | 0 (scale to zero when idle) |

**Activation**: Trigger `deploy-stamp.yml` with `LOW_COST_DEV_MODE=true`. The default (`false`) preserves existing behaviour for all push-triggered deploys.

Estimated monthly savings when active: ~$11–25 (Container Apps scale-to-zero + ingestion reduction). Actual verification requires a full billing cycle.

> ⚠️ Scale-to-zero means cold starts (~2–5s extra) for the first message after idle. Acceptable for personal dev use.

### Dirty Dev Mode (`dirtyDevMode`, #382)

For short-lived personal development stamps where cost matters more than retained Azure telemetry history, a second switch disables paid Azure observability outright.

| Setting | Normal | Dirty Dev Mode |
|---------|--------|----------------|
| Container Apps environment logs | `log-analytics` | `none` |
| Log Analytics workspace | deployed | not deployed |
| Application Insights resource | deployed | not deployed |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | set | omitted |
| Azure Monitor exporter | enabled | disabled at runtime |
| Query-based Azure Monitor alerts | enabled | not created |

**Activation**: Trigger `deploy-stamp.yml` with `DIRTY_DEV_MODE=true`.

> ⚠️ This mode is intentionally blunt. You keep live log streaming from Container Apps, but you lose retained Log Analytics/App Insights history and Azure Monitor query alerts for that stamp.

