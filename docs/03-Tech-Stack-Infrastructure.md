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
