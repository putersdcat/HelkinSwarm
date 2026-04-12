// ──────────────────────────────────────────────────────────────────────────────
// HelkinSwarm — Stamped Infrastructure Template (Single Source of Truth)
// Every user gets a dedicated, isolated Azure footprint.
// Resource naming: helkinswarm-{type}-{userAlias}
//
// Push to main → deploy-stamp.yml → this template. No manual portal work.
// All resources use User-Assigned Managed Identity. Zero secrets in code.
//
// @see docs/03-Tech-Stack-Infrastructure.md
// @see docs/0q-Multi-Instance-Architecture.md
// @see docs/12-Deployment-CICD.md
// ──────────────────────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

// ─── Parameters ─────────────────────────────────────────────────────────────

@description('4-char alphanumeric user alias. All resources suffixed with this. REQUIRED — no default.')
@minLength(4)
@maxLength(4)
param userAlias string

@description('Primary deployment location — FreedomMode: US-centric, global frontier models')
param location string = 'eastus2'

@description('EU Data Residency toggle. false = GlobalStandard (frontier), true = DataZoneStandard (EU)')
param euResidencyMode bool = false

@description('LLM provider. azure = AI Foundry, openrouter = BYOK proxy. OpenRouter is the current stamped default for quota relief; azure remains a reversible rollback lane.')
@allowed([ 'azure', 'openrouter' ])
param llmProvider string = 'openrouter'

@description('Object ID of the owner/operator (for Key Vault admin role)')
param userPrincipalId string

@description('Object ID of the CICD service principal used by GitHub Actions OIDC. Granted secret-read access to the stamp Key Vault for cross-pipeline OAuth connection updates.')
param cicdPrincipalId string = ''

@description('Owner email for P0 alert notifications')
param alertEmail string = ''

@description('Optional array of developer public IP CIDRs reserved for future temporary debug allowlisting during network hardening work. Example: developerAllowedIpCidrs=["203.0.113.10/32"]. Phase 1 stores the deployment intent; Phase 2 network ACL/private-endpoint work will enforce it.')
param developerAllowedIpCidrs array = []

@description('Client ID of the global router UAMI. When set, stamps use this for Bot Framework JWT validation instead of their own UAMI. Required after router is deployed.')
param routerBotId string = ''

@description('Resource ID of the global router UAMI. Required when routerBotId is provided.')
param routerUamiId string = ''

@description('Create/update the GraphOAuth Bot Service connection. Set true only on first stamp deploy or when OAuth scopes change. Leave false on all re-deploys to avoid ARM error 715-123420.')
param createOAuthConnection bool = false

@description('Client ID of the HelkinSwarm-DelegatedAuth Entra app used for user-delegated Graph access (OAuth card + OBO flows). Global resource — same across all stamps. MUST match webApplicationInfo.id in appPackage/manifest.json — this is the audience for tab SSO tokens.')
param delegatedAuthClientId string = 'd4e5cf74-9f99-4504-b4ab-d4516dd10577'

@secure()
@description('Client secret for the DelegatedAuth Entra app. Retrieved from Key Vault during pipeline deploy. Only required when createOAuthConnection=true.')
param delegatedAuthClientSecret string = ''

// ── LLM Model Configuration (configurable per provider) ──
// Deployment names must match Azure AI model deployment resources when llmProvider=azure.
// For openrouter, these are passed as model identifiers to the proxy.

@description('Primary LLM model. Azure default: grok-4-1-fast-non-reasoning. OpenRouter: e.g. openai/gpt-4o')
param llmPrimaryModel string = 'grok-4-1-fast-non-reasoning'

@description('Secondary LLM model. Azure default: o4-mini — different provider than primary for rate-limit isolation.')
param llmSecondaryModel string = 'o4-mini'

@description('Fallback primary model.')
param llmFallbackPrimaryModel string = 'DeepSeek-V3.2'

@description('Fallback secondary model.')
param llmFallbackSecondaryModel string = 'FW-Kimi-K2.5'

@description('Coding primary model.')
param llmCodingPrimaryModel string = 'FW-MiniMax-M2.5'

@description('Coding secondary model.')
param llmCodingSecondaryModel string = 'FW-Kimi-K2.5'

@description('Embedding model.')
param llmEmbeddingModel string = 'text-embedding-3-large'

@description('OpenRouter fallback primary model (used when llmProvider=openrouter).')
param openrouterFallbackPrimary string = 'minimax/minimax-m2.7'

@description('OpenRouter fallback secondary model (used when llmProvider=openrouter).')
param openrouterFallbackSecondary string = 'minimax/minimax-m2.7'

@description('Dev telemetry mode appended to bot replies. off|minimal|standard|verbose (#174)')
@allowed(['off', 'minimal', 'standard', 'verbose'])
param devTelemetryMode string = 'verbose'

@description('Low Cost Dev Mode — reduces observability spend while preserving the stamped chat runtime warm floor so the first user turn cannot vanish behind stamp scale-to-zero. (#303, #393, #410)')
param lowCostDevMode bool = false

@description('Dirty Dev Mode — disables paid Azure observability for the stamp (no Log Analytics persistence, no Application Insights resource, no Azure Monitor exporter). Intended for short-lived personal dev stamps only. (#382)')
param dirtyDevMode bool = false

@description('Early Dev Cost Guard — source-controlled cost lockdown for the furious development phase. While true, the stamp must stay in observability-off mode and keep a hard resource-group budget until the owner explicitly authorizes removal. (#579)')
param earlyDevCostGuard bool = true

@description('Monthly Azure spend ceiling in USD for the stamped resource group while the early dev cost guard is active. Default: 30 USD (~1 USD/day). (#579)')
@minValue(1)
param earlyDevMonthlyBudgetUsd int = 30

@description('Budget start date for the early-dev cost guard. Defaults to the first day of the current UTC month.')
param earlyDevBudgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')

@description('Enable the stamp-local Outlook send confirmation bypass policy for the primary developer stamp only.')
param stampPolicyAllowOutlookSendWithoutConfirmation bool = false

@description('Enable the stamp-local vault write confirmation bypass policy for the primary developer stamp only.')
param stampPolicyAllowVaultWriteWithoutConfirmation bool = false


// ─── Variables ──────────────────────────────────────────────────────────────

// Resource names — all follow helkinswarm-{type}-{alias} (lowercase)
var uamiName      = 'helkinswarm-id-${userAlias}'
var lawName       = 'helkinswarm-law-${userAlias}'
var appInsName    = 'helkinswarm-appi-${userAlias}'
var kvName        = 'helkinswarm-kv-${userAlias}'       // 20 chars max for alias a7f2 ✓
var uvName        = 'helkinswarm-uv-${userAlias}'       // user vault — max 19 chars ✓ (#178)
var acrName       = 'helkinswarmacr${userAlias}'         // globally unique, stamped per user
var stName        = 'helkinswarmst${userAlias}'          // globally unique, alphanumeric only
var cosmosName    = 'helkinswarm-cosmos-${userAlias}'    // globally unique
var aisName       = 'helkinswarm-ai-${userAlias}'
var caeName       = 'helkinswarm-cae-${userAlias}'
var funcName      = 'helkinswarm-func-${userAlias}'
var botName       = 'helkinswarm-bot-${userAlias}'

// Built-in ARM role definition IDs
// ─── Low Cost Dev Mode derived values (#303, #341, #393, #410) ─────────────
// Paid Log Analytics workspaces and workspace-based Application Insights can't
// use the old 7-day profile here; 30 days is the current minimum valid tier.
// Earlier low-cost mode also dropped the stamp to zero replicas, but the repo's
// own live evidence showed the first real post-idle user turn could still vanish
// before the handler existed. Preserve the personal-copilot stamp warm floor and
// save money through caps, sampling, and minimal telemetry instead.
var effectiveDirtyDevMode   = earlyDevCostGuard || dirtyDevMode
var effectiveLowCostDevMode = !effectiveDirtyDevMode && lowCostDevMode
var lawRetentionDays        = 30
var appInsRetentionDays     = 30
var funcInstanceMin         = 1
var effectiveTelemetryMode  = effectiveDirtyDevMode ? 'minimal' : effectiveLowCostDevMode ? 'minimal' : devTelemetryMode
var lawDailyCapGb           = effectiveLowCostDevMode ? json('0.1') : json('-1')  // -1 = no cap
var appInsSamplingPct       = effectiveLowCostDevMode ? 10  : 100
var appLogsDestination      = effectiveDirtyDevMode ? 'azure-monitor' : 'log-analytics'
var earlyDevBudgetName      = 'helkinswarm-earlydev-budget-${userAlias}'

var roleKvSecretsUser           = '4633458b-17de-408a-b874-0445c86b69e6'
var roleKvSecretsOfficer        = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'  // Get/List/Set/Delete (#178)
var roleKvAdmin                 = '00482a5a-887f-4fb3-b363-3b7fe8e74483'
var roleAcrPull                 = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var roleCognitiveServicesUser   = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var roleStorageBlobDataOwner    = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var roleStorageQueueContributor = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var roleStorageTableContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var roleCostManagementReader    = '72fafb9e-0641-4937-9268-a91bfd8191a3' // helkin_get_costs (#232)
var roleReader                  = 'acdd72a7-3385-48ef-bd42-f606fba81ae7' // azuremcp arm read-only (#462)

// Cosmos DB built-in data-plane role IDs
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

// When the global router is deployed, stamps validate Bot Framework JWTs against the
// router UAMI (the single global Teams identity). Otherwise fall back to stamp UAMI.
var hasRouter = routerBotId != ''
var botMsaAppId = hasRouter ? routerBotId : uami.properties.clientId
var botMsaResourceId = hasRouter ? routerUamiId : uami.id
// Function app identities: always include stamp UAMI; add router UAMI when router exists
var stampIdentityObj = { '${uami.id}': {} }
var routerIdentityObj = hasRouter ? { '${routerUamiId}': {} } : {}
var allIdentityObjs = union(stampIdentityObj, routerIdentityObj)

// LLM model config — see params above. Old hardcoded vars removed in #100.

// ═══════════════════════════════════════════════════════════════════════════
//  1. LOG ANALYTICS WORKSPACE
// ═══════════════════════════════════════════════════════════════════════════

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (!effectiveDirtyDevMode) {
  name: lawName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: lawRetentionDays
    workspaceCapping: {
      dailyQuotaGb: lawDailyCapGb
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. APPLICATION INSIGHTS (spec 13)
// ═══════════════════════════════════════════════════════════════════════════

resource appInsights 'Microsoft.Insights/components@2020-02-02' = if (!effectiveDirtyDevMode) {
  name: appInsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    DisableIpMasking: false
    RetentionInDays: appInsRetentionDays
    SamplingPercentage: appInsSamplingPct
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. USER-ASSIGNED MANAGED IDENTITY (spec 11 — root runtime identity)
// ═══════════════════════════════════════════════════════════════════════════

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: uamiName
  location: location
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. STORAGE ACCOUNT (Azure Functions host + Durable Functions)
// ═══════════════════════════════════════════════════════════════════════════

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: stName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false   // #212 Phase 1 — force AAD-only auth, no storage keys
    networkAcls: {
      defaultAction: 'Allow'      // Phase 2 will change to 'Deny' after VNet integration
      bypass: 'AzureServices'      // Allow trusted Azure services (Functions, Durable Tasks)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. KEY VAULT (RBAC-based, no access policies — spec 11)
// ═══════════════════════════════════════════════════════════════════════════

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true  // #201 — prevent permanent secret destruction by agents
    sku: { family: 'A', name: 'standard' }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  5a. USER VAULT KEY VAULT (#178 — user-facing secrets: API keys, PATs)
//      UAMI has Secrets Officer (full CRUD for vault skill, confirmation-gated).
//      Owner has Administrator. CICD has no access — agent-managed only.
// ═══════════════════════════════════════════════════════════════════════════

resource userVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: uvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    sku: { family: 'A', name: 'standard' }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. CONTAINER REGISTRY (shared across stamps — MSI-based access)
//     NOTE: ACR is deployed in the first stamp's RG only. Subsequent stamps
//     reference the existing ACR. Use existingAcrResourceGroup param or
//     deploy ACR separately if needed for multi-stamp.
// ═══════════════════════════════════════════════════════════════════════════

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. COSMOS DB — Serverless (spec 07, 0i)
// ═══════════════════════════════════════════════════════════════════════════

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true           // #212 Phase 1 — force AAD/RBAC-only, no master keys
    locations: [
      { locationName: location, failoverPriority: 0 }
    ]
    capabilities: [
      { name: 'EnableServerless' }
      { name: 'EnableNoSQLVectorSearch' }
    ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: 'helkinswarm'
  properties: {
    resource: { id: 'helkinswarm' }
  }
}

// Cosmos containers — match spec exactly

resource containerUserProfiles 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'userProfiles'
  properties: {
    resource: {
      id: 'userProfiles'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: -1
    }
  }
}

resource containerSessions 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'sessions'
  properties: {
    resource: {
      id: 'sessions'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: 259200 // 72h
    }
  }
}

resource containerMultimodalMemory 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'multimodalMemory'
  properties: {
    resource: {
      id: 'multimodalMemory'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: 31536000 // 365 days
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          { path: '/*' }
        ]
        excludedPaths: [
          { path: '/_etag/?' }
          { path: '/vector/*' }
        ]
        vectorIndexes: [
          { path: '/vector', type: 'diskANN' }
        ]
      }
      vectorEmbeddingPolicy: {
        vectorEmbeddings: [
          {
            path: '/vector'
            dataType: 'float32'
            dimensions: 3072    // text-embedding-3-large outputs 3072 dims
            distanceFunction: 'cosine'
          }
        ]
      }
    }
  }
}

resource containerDurableHooks 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'durableHooks'
  properties: {
    resource: {
      id: 'durableHooks'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: 31536000 // 365 days
    }
  }
}

resource containerChronoBackplane 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'chronoBackplane'
  properties: {
    resource: {
      id: 'chronoBackplane'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: 604800 // 7 days — continuity / interruption breadcrumbs auto-expire
    }
  }
}

resource containerTentativeActions 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'tentativeActions'
  properties: {
    resource: {
      id: 'tentativeActions'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: 86400 // 24 hours — pending actions auto-expire
    }
  }
}

resource containerIdeMessages 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'ide-messages'
  properties: {
    resource: {
      id: 'ide-messages'
      partitionKey: { paths: [ '/correlationTag' ], kind: 'Hash' }
      defaultTtl: 604800 // 7 days (spec: 0g)
    }
  }
}

resource containerPendingIntents 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'pendingIntents'
  properties: {
    resource: {
      id: 'pendingIntents'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: 604800 // 7 days — pending intents auto-expire (#116)
    }
  }
}

resource containerConversationReferences 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'conversationReferences'
  properties: {
    resource: {
      id: 'conversationReferences'
      partitionKey: { paths: [ '/conversationId' ], kind: 'Hash' }
      defaultTtl: -1
    }
  }
}

resource containerVirtualEmployees 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'virtualEmployees'
  properties: {
    resource: {
      id: 'virtualEmployees'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: -1
    }
  }
}

resource containerRuntimeConfig 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'runtimeConfig'
  properties: {
    resource: {
      id: 'runtimeConfig'
      partitionKey: { paths: [ '/scope' ], kind: 'Hash' }
      defaultTtl: -1
    }
  }
}

resource containerLongRunningCatalog 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'longRunningCatalog'
  properties: {
    resource: {
      id: 'longRunningCatalog'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: -1 // persistent catalog
    }
  }
}

resource containerSkillMemory 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'skillMemory'
  properties: {
    resource: {
      id: 'skillMemory'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: 31536000 // 365 days
      indexingPolicy: {
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [ { path: '/embedding/*' } ]
      }
    }
  }
}

resource containerMsalTokenCache 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'msalTokenCache'
  properties: {
    resource: {
      id: 'msalTokenCache'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: 86400 // 24 hours — tokens are short-lived
    }
  }
}

// docs container — AI-native document storage skill (#244)
// Partition key /userId, no TTL (documents are permanent until explicitly deleted by the user)
resource containerDocs 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'docs'
  properties: {
    resource: {
      id: 'docs'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: -1
    }
  }
}

// ledger container — Lightweight Ledger / Bookkeeping skill (#246)
// Partition key /entryType (expense|revenue|invoice|transfer), no TTL (ledger entries are permanent)
resource containerLedger 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'ledger'
  properties: {
    resource: {
      id: 'ledger'
      partitionKey: { paths: [ '/entryType' ], kind: 'Hash' }
      defaultTtl: -1
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  8. AZURE AI SERVICES — Foundry (spec 03, 06)
//     SKU is always S0 at the account level.
//     euResidencyMode affects model DEPLOYMENT SKUs (Phase 3).
// ═══════════════════════════════════════════════════════════════════════════

resource aiServices 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: aisName
  location: location
  kind: 'AIServices'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: toLower(aisName)
    publicNetworkAccess: 'Enabled'     // Phase 2 will restrict after VNet + private endpoints
    disableLocalAuth: true              // #212 Phase 1 — force AAD-only, no API keys
  }
}

// ── AI Model Deployments — managed by infra/ai-deployments.bicep (#113) ───
// Deployed as a separate Bicep step in deploy-stamp.yml after main.bicep.
// See ai-deployments.bicep for quota strategy, budget ceiling, and capacity logic.

// ═══════════════════════════════════════════════════════════════════════════
//  9. CONTAINER APPS ENVIRONMENT (consumption plan)
// ═══════════════════════════════════════════════════════════════════════════

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: caeName
  location: location
  properties: {
    appLogsConfiguration: effectiveDirtyDevMode
      ? {
          destination: appLogsDestination
        }
      : {
          destination: appLogsDestination
          logAnalyticsConfiguration: {
            customerId: logAnalytics!.properties.customerId
            sharedKey: logAnalytics!.listKeys().primarySharedKey
          }
        }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  10. AZURE FUNCTIONS ON CONTAINER APPS (the digital body's home)
//      Initial image: MCR placeholder. deploy-stamp.yml updates to ACR image.
// ═══════════════════════════════════════════════════════════════════════════

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: funcName
  location: location
  kind: 'functionapp,linux,container'
  dependsOn: [
    roleKvUami
    roleStorageBlobUami
    roleStorageQueueUami
    roleStorageTableUami
  ]
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: allIdentityObjs
  }
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    keyVaultReferenceIdentity: uami.id
    siteConfig: {
      minimumElasticInstanceCount: funcInstanceMin
      functionAppScaleLimit: 5
      linuxFxVersion: 'DOCKER|${acrName}.azurecr.io/helkinswarm:latest'
      acrUseManagedIdentityCreds: true
      acrUserManagedIdentityID: uami.id
      healthCheckPath: '/api/health'
      appSettings: concat([
        // ── Functions runtime ──
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'AzureWebJobsFeatureFlags', value: 'EnableWorkerIndexing' }

        // ── Storage (identity-based, no connection string — spec 11) ──
        { name: 'AzureWebJobsStorage__accountName', value: storageAccount.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobsStorage__clientId', value: uami.properties.clientId }

        // ── Bot Framework UAMI (spec 11) ──
        // When router is deployed, MICROSOFT_APP_ID = router UAMI (global bot identity).
        // Stamps must share the router's bot ID to validate Bot Framework JWTs correctly.
        { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId }
        { name: 'MICROSOFT_APP_ID', value: botMsaAppId }
        { name: 'MICROSOFT_APP_TYPE', value: 'UserAssignedMsi' }
        { name: 'MICROSOFT_APP_TENANT_ID', value: subscription().tenantId }

        // ── Cosmos DB (MSI-based, no connection string) ──
        { name: 'COSMOS_ENDPOINT', value: cosmosAccount.properties.documentEndpoint }

        // ── AI Foundry ──
        { name: 'AZURE_AI_FOUNDRY_ENDPOINT', value: aiServices.properties.endpoint }
        { name: 'AZURE_CONTENT_SAFETY_ENDPOINT', value: aiServices.properties.endpoint }

        // ── LLM Config (spec 06) ──
        { name: 'LLM_PRIMARY_MODEL',          value: llmPrimaryModel }
        { name: 'LLM_SECONDARY_MODEL',         value: llmSecondaryModel }
        { name: 'LLM_FALLBACK_PRIMARY',        value: llmFallbackPrimaryModel }
        { name: 'LLM_FALLBACK_SECONDARY',      value: llmFallbackSecondaryModel }
        { name: 'LLM_CODING_PRIMARY',          value: llmCodingPrimaryModel }
        { name: 'LLM_CODING_SECONDARY',        value: llmCodingSecondaryModel }
        { name: 'LLM_EMBEDDING_MODEL',         value: llmEmbeddingModel }
        { name: 'EU_RESIDENCY_MODE',           value: string(euResidencyMode) }
        { name: 'LLM_PROVIDER',                value: llmProvider }

        // ── BYOK: OpenRouter (spec 0c) — key stored in Key Vault (#100) ──
        { name: 'OPENROUTER_API_KEY', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=OpenRouterApiKey)' }
        { name: 'OPENROUTER_FALLBACK_PRIMARY', value: openrouterFallbackPrimary }
        { name: 'OPENROUTER_FALLBACK_SECONDARY', value: openrouterFallbackSecondary }

        // ── Web search: Brave Search API key from Key Vault (#190) ──
        { name: 'BRAVE_SEARCH_API_KEY', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=BraveSearchApiKey)' }

        // ── OBO / Delegated Identity (spec 11) ──
        { name: 'BOT_OAUTH_CONNECTION_NAME', value: 'GraphOAuth' }
        { name: 'ENTRA_DELEGATED_AUTH_CLIENT_ID', value: delegatedAuthClientId }
        { name: 'ENTRA_OBO_CLIENT_SECRET', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=DelegatedAuthClientSecret)' }

        // ── GitHub App auth — KV references resolved by UAMI at runtime ──
        { name: 'SKILLFORGE_GITHUB_APP_ID',              value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=SkillForgeGitHubAppId)' }
        { name: 'SKILLFORGE_GITHUB_APP_INSTALLATION_ID', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=SkillForgeGitHubInstallationId)' }
        { name: 'SKILLFORGE_GITHUB_APP_PRIVATE_KEY',     value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=SkillForgeGitHubAppPrivateKey)' }
        { name: 'GITHUB_APP_ID',              value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=GitHubAppId)' }
        { name: 'GITHUB_APP_INSTALLATION_ID', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=GitHubInstallationId)' }
        { name: 'GITHUB_APP_PRIVATE_KEY',     value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=GitHubAppPrivateKey)' }

        // ── Stamp identity ──
        { name: 'USER_ALIAS', value: userAlias }
        { name: 'USER_VAULT_KEY_VAULT_URI', value: 'https://${uvName}${environment().suffixes.keyvaultDns}/' }
        { name: 'DOCS_STORAGE_ACCOUNT_NAME', value: storageAccount.name }
        { name: 'DIRTY_DEV_MODE', value: string(effectiveDirtyDevMode) }
        { name: 'EARLY_DEV_COST_GUARD', value: string(earlyDevCostGuard) }

        // ── Host logging overrides — suppress known Azure SDK / Durable chatter that exploded LAW cost in dev (#579) ──
        { name: 'AzureFunctionsJobHost__logging__logLevel__Host.Aggregator', value: 'Warning' }
        { name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Core', value: 'Warning' }
        { name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Core.1', value: 'Warning' }
        { name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Identity', value: 'Warning' }
        { name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Identity.1', value: 'Warning' }
        { name: 'AzureFunctionsJobHost__logging__logLevel__DurableTask.AzureStorage', value: 'Warning' }
        { name: 'AzureFunctionsJobHost__logging__logLevel__Host.Triggers.DurableTask', value: 'Warning' }

        // ── Feature toggles ──
        { name: 'SKILLFORGE_ENABLED', value: 'true' }
        { name: 'SKILLFORGE_ACR_IMAGE', value: '' }
        { name: 'SKILLFORGE_TIMEOUT_MINUTES', value: '15' }
        { name: 'SKILLFORGE_CPU_KILL_THRESHOLD', value: '80' }
        { name: 'SKILLFORGE_MEMORY_LIMIT_MB', value: '2048' }
        { name: 'SKILLFORGE_RESOURCE_GROUP', value: resourceGroup().name }
        { name: 'AZURE_SUBSCRIPTION_ID', value: subscription().subscriptionId }
        { name: 'AZURE_RESOURCE_GROUP', value: resourceGroup().name }
        { name: 'MAINTENANCE_MODE', value: 'false' }
        { name: 'LIVING_MIND_COMPAT_MODE', value: 'false' }
        { name: 'STAMP_POLICY_ALLOW_OUTLOOK_SEND_WITHOUT_CONFIRMATION', value: string(stampPolicyAllowOutlookSendWithoutConfirmation) }
        { name: 'STAMP_POLICY_ALLOW_VAULT_WRITE_WITHOUT_CONFIRMATION', value: string(stampPolicyAllowVaultWriteWithoutConfirmation) }

        // ── Dev telemetry (spec 0n, #174) ──
        { name: 'DEV_TELEMETRY_MODE', value: effectiveTelemetryMode }
      ], effectiveDirtyDevMode ? [] : [
        // ── Observability (spec 13) ──
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights!.properties.ConnectionString }
      ])
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  11. BOT SERVICE + TEAMS CHANNEL (spec 10)
// ═══════════════════════════════════════════════════════════════════════════

resource botService 'Microsoft.BotService/botServices@2022-09-15' = {
  name: botName
  location: 'global'
  kind: 'azurebot'
  sku: { name: 'F0' }
  properties: {
    displayName: 'HelkinSwarm (${userAlias})'
    endpoint: 'https://${functionApp.properties.defaultHostName}/api/messages'
    msaAppId: botMsaAppId
    msaAppType: 'UserAssignedMSI'
    msaAppMSIResourceId: botMsaResourceId
    msaAppTenantId: subscription().tenantId
  }
}

// When the router is deployed, it owns the Teams Channel for this bot identity.
// Stamp bot services omit the Teams Channel to avoid duplicate channel registrations.
resource teamsChannel 'Microsoft.BotService/botServices/channels@2022-09-15' = if (!hasRouter) {
  parent: botService
  name: 'MsTeamsChannel'
  location: 'global'
  properties: {
    channelName: 'MsTeamsChannel'
    properties: {
      isEnabled: true
    }
  }
}

resource oauthConnection 'Microsoft.BotService/botServices/connections@2022-09-15' = if (createOAuthConnection) {
  parent: botService
  name: 'GraphOAuth'
  location: 'global'
  properties: {
    serviceProviderDisplayName: 'Azure Active Directory v2'
    serviceProviderId: '30dd229c-58e3-4a48-bdfd-91ec48eb906c'
    clientId: delegatedAuthClientId
    clientSecret: delegatedAuthClientSecret
    scopes: 'User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite People.Read offline_access'
    parameters: [
      { key: 'tenantID', value: subscription().tenantId }
      { key: 'clientId', value: delegatedAuthClientId }
      { key: 'clientSecret', value: delegatedAuthClientSecret }
      { key: 'scopes', value: 'User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite People.Read offline_access' }
    ]
  }
}

resource earlyDevBudget 'Microsoft.Consumption/budgets@2024-08-01' = if (earlyDevCostGuard && alertEmail != '') {
  scope: resourceGroup()
  name: earlyDevBudgetName
  properties: {
    amount: earlyDevMonthlyBudgetUsd
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: earlyDevBudgetStartDate
    }
    notifications: {
      Actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [
          alertEmail
        ]
        contactRoles: []
        contactGroups: []
        locale: 'en-us'
      }
      Actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [
          alertEmail
        ]
        contactRoles: []
        contactGroups: []
        locale: 'en-us'
      }
      Forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [
          alertEmail
        ]
        contactRoles: []
        contactGroups: []
        locale: 'en-us'
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  12. RBAC ROLE ASSIGNMENTS
//      Uses deterministic GUIDs (guid()) for idempotency.
// ═══════════════════════════════════════════════════════════════════════════

// ── UAMI → Key Vault Secrets User ──
resource roleKvUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, keyVault.id, roleKvSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvSecretsUser)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Owner → Key Vault Administrator ──
resource roleKvUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(userPrincipalId, keyVault.id, roleKvAdmin)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvAdmin)
    principalId: userPrincipalId
    principalType: 'User'
  }
}

// ── CICD SP → Key Vault Secrets User ──
resource roleKvCicd 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (cicdPrincipalId != '') {
  name: guid(cicdPrincipalId, keyVault.id, roleKvSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvSecretsUser)
    principalId: cicdPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → User Vault Secrets Officer (vault skill: full CRUD, confirmation-gated) ── (#178)
resource roleUvUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, userVault.id, roleKvSecretsOfficer)
  scope: userVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvSecretsOfficer)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Owner → User Vault Administrator ── (#178)
resource roleUvUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(userPrincipalId, userVault.id, roleKvAdmin)
  scope: userVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvAdmin)
    principalId: userPrincipalId
    principalType: 'User'
  }
}

// ── UAMI → ACR Pull ──
resource roleAcrUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, acr.id, roleAcrPull)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAcrPull)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → Cognitive Services User ──
resource roleAiUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, aiServices.id, roleCognitiveServicesUser)
  scope: aiServices
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleCognitiveServicesUser)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → Storage Blob Data Owner ──
resource roleStorageBlobUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, storageAccount.id, roleStorageBlobDataOwner)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageBlobDataOwner)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → Storage Queue Data Contributor ──
resource roleStorageQueueUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, storageAccount.id, roleStorageQueueContributor)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageQueueContributor)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → Storage Table Data Contributor ──
resource roleStorageTableUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, storageAccount.id, roleStorageTableContributor)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageTableContributor)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → Cosmos DB Built-in Data Contributor ──
resource cosmosDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(uami.id, cosmosAccount.id, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: uami.properties.principalId
    scope: cosmosAccount.id
  }
}

// ── UAMI → Reader (RG scope — azuremcp arm subscription/resource list #462) ──
resource roleReaderUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, resourceGroup().id, roleReader)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleReader)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → Cost Management Reader (RG scope — helkin_get_costs #232) ──
resource roleCostMgmtUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, resourceGroup().id, roleCostManagementReader)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleCostManagementReader)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  13. P0 ALERTING RULES (spec 13)
// ═══════════════════════════════════════════════════════════════════════════

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (!effectiveDirtyDevMode && alertEmail != '') {
  name: 'helkinswarm-ag-${userAlias}'
  location: 'global'
  properties: {
    groupShortName: 'HlknP0'
    enabled: true
    emailReceivers: [
      {
        name: 'OwnerEmail'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource alertEmergencyStop 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (!effectiveDirtyDevMode) {
  name: 'helkinswarm-alert-estop-${userAlias}'
  location: location
  properties: {
    displayName: 'HelkinSwarm [${userAlias}] — Emergency Stop Triggered'
    description: 'Fires when /emergency-stop is activated or deactivated.'
    severity: 1
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [ appInsights.id ]
    criteria: {
      allOf: [
        {
          query: 'customEvents | where name == "EmergencyStop"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: alertEmail != '' ? [ actionGroup.id ] : []
    }
  }
}

resource alertRateLimit 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (!effectiveDirtyDevMode) {
  name: 'helkinswarm-alert-ratelimit-${userAlias}'
  location: location
  properties: {
    displayName: 'HelkinSwarm [${userAlias}] — LLM Rate Limit Exhaustion'
    description: 'Fires when Foundry API returns 429. Threshold: 3+ in 5 minutes.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [ appInsights.id ]
    criteria: {
      allOf: [
        {
          query: 'customEvents | where name == "LlmCall" and tostring(customDimensions["finishReason"]) == "error" | where tostring(customDimensions["error"]) contains "429"'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 3
        }
      ]
    }
    actions: {
      actionGroups: alertEmail != '' ? [ actionGroup.id ] : []
    }
  }
}

resource alertVerificationFailure 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (!effectiveDirtyDevMode) {
  name: 'helkinswarm-alert-verify-${userAlias}'
  location: location
  properties: {
    displayName: 'HelkinSwarm [${userAlias}] — Verification Pipeline Failure'
    description: 'Fires when high-risk tool dispatch fails verification.'
    severity: 1
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [ appInsights.id ]
    criteria: {
      allOf: [
        {
          query: 'customEvents | where name == "ToolDispatch" and tostring(customDimensions["riskLevel"]) in ("high", "critical") and tostring(customDimensions["approved"]) == "false"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: alertEmail != '' ? [ actionGroup.id ] : []
    }
  }
}

resource alertPromptShield 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (!effectiveDirtyDevMode) {
  name: 'helkinswarm-alert-shield-${userAlias}'
  location: location
  properties: {
    displayName: 'HelkinSwarm [${userAlias}] — Prompt Shield Block'
    description: 'Fires when Prompt Shields blocks a user message.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [ appInsights.id ]
    criteria: {
      allOf: [
        {
          query: 'customEvents | where name == "PromptShieldResult" and tostring(customDimensions["blocked"]) == "true"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: alertEmail != '' ? [ actionGroup.id ] : []
    }
  }
}

resource alertOrchestratorFailure 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (!effectiveDirtyDevMode) {
  name: 'helkinswarm-alert-orch-${userAlias}'
  location: location
  properties: {
    displayName: 'HelkinSwarm [${userAlias}] — Orchestrator Failure'
    description: 'Fires when session orchestrator or overseer fails.'
    severity: 1
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [ appInsights.id ]
    criteria: {
      allOf: [
        {
          query: 'exceptions | where outerMessage contains "orchestrator" or outerMessage contains "Durable" or outerMessage contains "overseer"'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 3
        }
      ]
    }
    actions: {
      actionGroups: alertEmail != '' ? [ actionGroup.id ] : []
    }
  }
}

resource alertEuViolation 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (!effectiveDirtyDevMode) {
  name: 'helkinswarm-alert-eu-${userAlias}'
  location: location
  properties: {
    displayName: 'HelkinSwarm [${userAlias}] — EU Residency Violation'
    description: 'Fires when EU-mode is enabled but a request routes to a non-EU endpoint.'
    severity: 0
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [ appInsights.id ]
    criteria: {
      allOf: [
        {
          query: 'customEvents | where name == "EuResidencyViolation" or (name == "LlmCall" and tostring(customDimensions["euMode"]) == "true" and tostring(customDimensions["provider"]) != "azure-eu")'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: alertEmail != '' ? [ actionGroup.id ] : []
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  OUTPUTS (consumed by deploy-stamp.yml pipeline)
// ═══════════════════════════════════════════════════════════════════════════

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output functionAppName string = functionApp.name
output managedIdentityClientId string = uami.properties.clientId
output managedIdentityResourceId string = uami.id
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output aiEndpoint string = aiServices.properties.endpoint
output appInsightsConnectionString string = effectiveDirtyDevMode ? '' : appInsights!.properties.ConnectionString
output botEndpoint string = 'https://${functionApp.properties.defaultHostName}/api/messages'
output healthEndpoint string = 'https://${functionApp.properties.defaultHostName}/api/health'
output developerAllowedIpCidrsConfigured array = developerAllowedIpCidrs
output earlyDevBudgetName string = earlyDevCostGuard && alertEmail != '' ? earlyDevBudget.name : ''
