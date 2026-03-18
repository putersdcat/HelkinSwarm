// ──────────────────────────────────────────────────────────────────────────────
// HelkinSwarm — Desired-State Infrastructure (Single Source of Truth)
// ⚠️ MARK FOR IMMEDIATE REFACTOR before first run in v2.
// Reference implementation only — alpha-specific resource names to be updated.
//
// Push to main = deploy. No manual portal work after one-time bootstrap.
// All resources use User-Assigned Managed Identity. Zero secrets in code.
//
// @see docs/03-Tech-Stack-Infrastructure.md
// @see docs/12-Deployment-CICD.md
// ──────────────────────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

// ─── Parameters ─────────────────────────────────────────────────────────────

@description('Primary deployment location — FreedomMode: US-centric, global frontier models')
param location string = 'eastus2'

@description('EU Data Residency toggle. false = GlobalStandard (frontier), true = DataZoneStandard (EU)')
param euResidencyMode bool = false

@description('LLM provider. azure = AI Foundry, openrouter = BYOK proxy')
@allowed([ 'azure', 'openrouter' ])
param llmProvider string = 'azure'

@description('Object ID of the owner/operator (for Key Vault admin role)')
param userPrincipalId string

@description('Owner email for P0 alert notifications')
param alertEmail string = ''

// ─── Variables ──────────────────────────────────────────────────────────────

var suffix = 'prod-eus2'

// Resource names — all lowercase (Azure Sites/CAE/Cognitive Services require it)
var uamiName      = 'helkinswarm-id-${suffix}'
var lawName       = 'helkinswarm-law-${suffix}'
var appInsName    = 'helkinswarm-appins-${suffix}'
var kvName        = 'helkinswarm-kv-${suffix}'   // 24 chars max — currently 24 ✓
var acrName       = 'helkinswarmacr'              // globally unique, alphanumeric only
var stName        = 'helkinswarmst'               // globally unique, alphanumeric only
var cosmosName    = 'helkinswarm-cosmos'           // globally unique
var aisName       = 'helkinswarm-ais-${suffix}'
var caeName       = 'helkinswarm-cae-${suffix}'
var funcName      = 'helkinswarm-func-${suffix}'
var botName       = 'helkinswarm-bot-${suffix}'

// Built-in ARM role definition IDs
var roleKvSecretsUser           = '4633458b-17de-408a-b874-0445c86b69e6'
var roleKvAdmin                 = '00482a5a-887f-4fb3-b363-3b7fe8e74483'
var roleAcrPull                 = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var roleCognitiveServicesUser   = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var roleStorageBlobDataOwner    = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var roleStorageQueueContributor = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var roleStorageTableContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

// Cosmos DB built-in data-plane role IDs
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

// LLM model names — toggled by euResidencyMode (spec 03, 06)
// FreedomMode: gpt-5 primary (1000K TPM), grok secondary (50K TPM). Grok hard-capped at 50K.
var llmPrimary   = euResidencyMode ? 'gpt-5' : 'gpt-5'
var llmSecondary = euResidencyMode ? 'gpt-5-mini' : 'grok-4-1-fast-reasoning'
// var embeddingModel = 'text-embedding-3-large' // Unused — model deployments managed imperatively (#144)

// ═══════════════════════════════════════════════════════════════════════════
//  1. LOG ANALYTICS WORKSPACE
// ═══════════════════════════════════════════════════════════════════════════

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. APPLICATION INSIGHTS (spec 13)
// ═══════════════════════════════════════════════════════════════════════════

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    DisableIpMasking: false
    RetentionInDays: 30
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
    sku: { family: 'A', name: 'standard' }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. CONTAINER REGISTRY (MSI-based access, no admin user)
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
    locations: [
      { locationName: location, failoverPriority: 0 }
    ]
    capabilities: [
      { name: 'EnableServerless' }
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

// All 7 containers match cosmosClient.ts CONTAINER_DEFS exactly.
// Partition keys and TTLs are the single source of truth — code mirrors these.

resource containerUserProfiles 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'userProfiles'
  properties: {
    resource: {
      id: 'userProfiles'
      partitionKey: { paths: [ '/userId' ], kind: 'Hash' }
      defaultTtl: -1 // Permanent — user profiles never expire
    }
  }
}

resource containerSessions 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: 'sessions'
  properties: {
    resource: {
      id: 'sessions'
      partitionKey: { paths: [ '/sessionId' ], kind: 'Hash' }
      defaultTtl: 259200 // 72h (3 days) — session state auto-cleanup
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
      defaultTtl: 31536000 // 365 days — long-term memory
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
      defaultTtl: 31536000 // 365 days — persistent triggers
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
      defaultTtl: 86400 // 24h — DevLoop protocol messages
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
      defaultTtl: -1 // Permanent — conversation references persist indefinitely
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
      defaultTtl: -1 // Permanent — virtual employee definitions persist indefinitely
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
      defaultTtl: -1 // Permanent — runtime config flags persist indefinitely
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
    publicNetworkAccess: 'Enabled'
  }
}

// ── AI Model Deployments — MANAGED IMPERATIVELY (#144) ──────────────────
// Azure Cognitive Services returns opaque error 715-123420 on ALL model
// deployment operations (create AND update) in this subscription.
// Model deployments exist in Azure and are functioning — they just can't
// be managed via ARM/Bicep until Azure resolves the backend issue.
//
// Currently deployed (verified via az cognitiveservices account deployment list):
//   1. grok-4-1-fast-reasoning  (xAI, GlobalStandard, 50K TPM)
//   2. grok-4-1-fast            (xAI, GlobalStandard, 50K TPM) — model: grok-4-1-fast-non-reasoning
//   3. text-embedding-3-large   (OpenAI, GlobalStandard, 50K TPM)
//
// To re-add to Bicep when Azure fixes 715-123420, restore from git history:
//   git show 895ff11:infra/main.bicep | grep -A 20 'llmPrimaryDeployment\|llmSecondaryDeployment\|embeddingDeployment'
// Or create manually:
//   az cognitiveservices account deployment create --name helkinswarm-ais-prod-eus2 \
//     --resource-group helkinswarm-prod-eus2 --deployment-name <name> \
//     --model-name <model> --model-version 1 --model-format <format> \
//     --sku-name GlobalStandard --sku-capacity 50

// Additional models (gpt-5, o4-mini) also blocked — see comments above.

// ═══════════════════════════════════════════════════════════════════════════
//  9. CONTAINER APPS ENVIRONMENT (consumption plan)
// ═══════════════════════════════════════════════════════════════════════════

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: caeName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  10. AZURE FUNCTIONS ON CONTAINER APPS (the digital body's home)
//      Initial image: MCR placeholder. CD pipeline updates to ACR image.
// ═══════════════════════════════════════════════════════════════════════════

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: funcName
  location: location
  kind: 'functionapp,linux,container'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnv.id
    keyVaultReferenceIdentity: uami.id  // Required for @Microsoft.KeyVault() refs with UAMI
    siteConfig: {
      // ── Scale settings (prevent scale-to-zero killing Durable activities) ──
      // Container Apps Consumption sends SIGTERM when it sees no HTTP traffic,
      // but Durable Functions activities run via Storage queues, not HTTP.
      // Keep at least 1 instance always running. See #146.
      minimumElasticInstanceCount: 1
      functionAppScaleLimit: 5
      linuxFxVersion: 'DOCKER|mcr.microsoft.com/azure-functions/node:4-node22'
      appSettings: [
        // ── Functions runtime ──
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'AzureWebJobsFeatureFlags', value: 'EnableWorkerIndexing' }

        // ── Storage (identity-based, no connection string — spec 11) ──
        { name: 'AzureWebJobsStorage__accountName', value: storageAccount.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobsStorage__clientId', value: uami.properties.clientId }

        // ── Bot Framework UAMI (spec 11) ──
        { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId }
        { name: 'MICROSOFT_APP_ID', value: uami.properties.clientId }
        { name: 'MICROSOFT_APP_TYPE', value: 'UserAssignedMsi' }
        { name: 'MICROSOFT_APP_TENANT_ID', value: subscription().tenantId }

        // ── Cosmos DB (MSI-based, no connection string) ──
        { name: 'COSMOS_ENDPOINT', value: cosmosAccount.properties.documentEndpoint }

        // ── AI Foundry ──
        { name: 'AZURE_AI_FOUNDRY_ENDPOINT', value: aiServices.properties.endpoint }

        // ── Content Safety (same endpoint as AI Services; Prompt Shields API) ──
        { name: 'AZURE_CONTENT_SAFETY_ENDPOINT', value: aiServices.properties.endpoint }

        // ── LLM Config (spec 06 — toggled by euResidencyMode) ──
        { name: 'LLM_PRIMARY_MODEL', value: llmPrimary }
        { name: 'LLM_SECONDARY_MODEL', value: llmSecondary }
        { name: 'EU_RESIDENCY_MODE', value: string(euResidencyMode) }
        { name: 'LLM_PROVIDER', value: llmProvider }

        // ── BYOK: OpenRouter (spec 0c) ──
        // Key must be manually stored: az keyvault secret set --vault-name helkinswarm-kv-prod-eus2 --name openrouter-api-key --value <key>
        // Always inject KV reference regardless of llmProvider — enables automatic fallback
        // when Azure Foundry fails (502, timeout). If the secret doesn't exist in KV,
        // the env var resolves to empty string and the fallback is gracefully skipped.
        { name: 'OPENROUTER_API_KEY', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=openrouter-api-key)' }
        // Per-lane fallback models for OpenRouter (#161) — used when Azure Foundry fails
        // Default: Kimi K2.5 (moonshotai/kimi-k2.5) — strong reasoning, cheap, fast
        { name: 'OPENROUTER_FALLBACK_PRIMARY', value: 'moonshotai/kimi-k2.5' }
        { name: 'OPENROUTER_FALLBACK_SECONDARY', value: 'moonshotai/kimi-k2.5' }

        // ── OBO / Delegated Identity (spec 11) ──
        // Client secret must be manually stored: az keyvault secret set --vault-name helkinswarm-kv-prod-eus2 --name entra-obo-client-secret --value <secret>
        // NOTE: KV ref only activates when secret exists. Until then, OBO is gracefully disabled.
        { name: 'BOT_OAUTH_CONNECTION_NAME', value: 'GraphOAuth' }
        { name: 'ENTRA_OBO_CLIENT_SECRET', value: '' }

        // ── GitHub API (skills/github — PAT from Key Vault) ──
        // Token must be manually stored: az keyvault secret set --vault-name helkinswarm-kv-prod-eus2 --name github-token --value <PAT>
        // Required scopes: repo (full control of private repos)
        { name: 'GITHUB_TOKEN', value: '@Microsoft.KeyVault(VaultName=${kvName};SecretName=github-token)' }

        // ── Observability (spec 13) ──
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }

        // ── Feature toggles ──
        { name: 'SKILLFORGE_ENABLED', value: 'false' }
        { name: 'SKILLFORGE_ACR_IMAGE', value: '' }   // Set to ACR image URI to enable ACI mode
        { name: 'SKILLFORGE_RESOURCE_GROUP', value: resourceGroup().name }
        { name: 'AZURE_SUBSCRIPTION_ID', value: subscription().subscriptionId }
        { name: 'AZURE_RESOURCE_GROUP', value: resourceGroup().name }
        { name: 'MAINTENANCE_MODE', value: 'false' }
      ]
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  11. BOT SERVICE + TEAMS CHANNEL (spec 10)
//      NOTE: defaultHostName may not resolve correctly for Functions on CAE.
//      The CD pipeline post-deploy step verifies and corrects the endpoint.
// ═══════════════════════════════════════════════════════════════════════════

resource botService 'Microsoft.BotService/botServices@2022-09-15' = {
  name: botName
  location: 'global' // Bot Service is always global
  kind: 'azurebot'
  sku: { name: 'F0' }
  properties: {
    displayName: 'HelkinSwarm'
    endpoint: 'https://${functionApp.properties.defaultHostName}/api/messages'
    msaAppId: uami.properties.clientId
    msaAppType: 'UserAssignedMSI'
    msaAppMSIResourceId: uami.id
    msaAppTenantId: subscription().tenantId
  }
}

resource teamsChannel 'Microsoft.BotService/botServices/channels@2022-09-15' = {
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

// ── OAuth Connection for delegated user identity (spec 11 — OBO) ──
// Requires: Entra app registration with Graph delegated permissions.
// Client secret must be stored: az keyvault secret set --vault-name helkinswarm-kv-prod-eus2 --name entra-obo-client-secret --value <secret>
// NOTE: Deployed as a skeleton. Configure client secret via Azure Portal > Bot Service > Settings > OAuth Connections
//       after the Entra app registration is set up.
resource oauthConnection 'Microsoft.BotService/botServices/connections@2022-09-15' = {
  parent: botService
  name: 'GraphOAuth'
  location: 'global'
  properties: {
    serviceProviderDisplayName: 'Azure Active Directory v2'
    serviceProviderId: '30dd229c-58e3-4a48-bdfd-91ec48eb906c'
    clientId: uami.properties.clientId
    clientSecret: 'configure-via-portal'
    scopes: 'User.Read Mail.ReadWrite Calendars.ReadWrite Files.ReadWrite offline_access'
    parameters: [
      { key: 'tenantID', value: subscription().tenantId }
    ]
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  12. RBAC ROLE ASSIGNMENTS
//      Uses deterministic GUIDs (guid()) for idempotency.
//      CD pipeline has a pre-deploy cleanup step for partial-failure recovery.
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

// ── UAMI → Storage Blob Data Owner (Functions host + Durable Functions) ──
resource roleStorageBlobUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, storageAccount.id, roleStorageBlobDataOwner)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageBlobDataOwner)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → Storage Queue Data Contributor (Durable Functions — Phase 2) ──
resource roleStorageQueueUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, storageAccount.id, roleStorageQueueContributor)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageQueueContributor)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → Storage Table Data Contributor (Durable Functions — Phase 2) ──
resource roleStorageTableUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(uami.id, storageAccount.id, roleStorageTableContributor)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageTableContributor)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── UAMI → Cosmos DB Built-in Data Contributor (data plane role) ──
resource cosmosDataRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(uami.id, cosmosAccount.id, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: uami.properties.principalId
    scope: cosmosAccount.id
  }
}

// ── UAMI → ACI Contributor (SkillForge ephemeral containers) ──
// NOTE: No built-in "Container Instance Contributor" role exists.
// When activating SkillForge, manually assign the Contributor role
// scoped to the ACI container groups:
//   az role assignment create --assignee <UAMI-principal-id> \
//     --role "Contributor" --scope /subscriptions/.../resourceGroups/...
// A custom role with Microsoft.ContainerInstance/* is recommended.

// ═══════════════════════════════════════════════════════════════════════════
//  13. P0 ALERTING RULES (spec 13)
//      Log-based alerts on custom telemetry events tracked by the runtime.
//      All alerts auto-deployed with infrastructure — never manually created.
// ═══════════════════════════════════════════════════════════════════════════

// ── Action Group (email notifications) ──
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (alertEmail != '') {
  name: 'helkinswarm-ag-${suffix}'
  location: 'global'
  properties: {
    groupShortName: 'HelkinP0'
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

// ── Alert: Emergency Stop Triggered ──
resource alertEmergencyStop 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'helkinswarm-alert-emergency-stop'
  location: location
  properties: {
    displayName: 'HelkinSwarm — Emergency Stop Triggered'
    description: 'Fires when /emergency-stop is activated or deactivated.'
    severity: 1 // Sev1 = Critical
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

// ── Alert: Rate Limit Exhaustion (Foundry 429) ──
resource alertRateLimit 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'helkinswarm-alert-rate-limit'
  location: location
  properties: {
    displayName: 'HelkinSwarm — LLM Rate Limit Exhaustion'
    description: 'Fires when the Foundry API returns HTTP 429 (rate limited). Threshold: 3+ in 5 minutes.'
    severity: 2 // Sev2 = Warning
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

// ── Alert: Verification Pipeline Failure (high-risk action blocked) ──
resource alertVerificationFailure 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'helkinswarm-alert-verification-failure'
  location: location
  properties: {
    displayName: 'HelkinSwarm — High-Risk Action Verification Failure'
    description: 'Fires when a high-risk tool dispatch fails verification. Indicates potential safety pipeline issues.'
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

// ── Alert: Prompt Shield Block (injection/jailbreak detected) ──
resource alertPromptShield 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'helkinswarm-alert-prompt-shield'
  location: location
  properties: {
    displayName: 'HelkinSwarm — Prompt Shield Block'
    description: 'Fires when Prompt Shields blocks a user message (injection/jailbreak attempt).'
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

// ── Alert: Durable Orchestrator Failures ──
resource alertOrchestratorFailure 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'helkinswarm-alert-orchestrator-failure'
  location: location
  properties: {
    displayName: 'HelkinSwarm — Orchestrator Failure'
    description: 'Fires when session orchestrator or overseer fails. 3+ failures in 15 minutes indicates systemic issue.'
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

// ── Alert: EU Residency Violation ──
resource alertEuViolation 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'helkinswarm-alert-eu-violation'
  location: location
  properties: {
    displayName: 'HelkinSwarm — EU Residency Violation'
    description: 'Fires when EU-mode is enabled but a request routes to a non-EU model or endpoint.'
    severity: 0 // Sev0 = Critical (data residency is highest priority)
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
//  OUTPUTS (consumed by CD pipeline)
// ═══════════════════════════════════════════════════════════════════════════

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output functionAppName string = functionApp.name
output managedIdentityClientId string = uami.properties.clientId
output managedIdentityResourceId string = uami.id
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output aiEndpoint string = aiServices.properties.endpoint
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output botEndpoint string = 'https://${functionApp.properties.defaultHostName}/api/messages'
output healthEndpoint string = 'https://${functionApp.properties.defaultHostName}/api/health'
