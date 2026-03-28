// ──────────────────────────────────────────────────────────────────────────────
// HelkinSwarm — Global Router Infrastructure
// Single Azure Function App on Container Apps (Consumption workload profile)
// that routes Teams activities to user-specific stamps by
// aadObjectId → user-map.json lookup.
//
// Deployed once, globally. Not per-stamp.
// Resource group: rg-helkinswarm-router
// Bot identity: helkinswarm-id-router — created fresh here, never recycled from Alpha.
//
// @see docs/0q-Multi-Instance-Architecture.md
// @see docs/IDENTITY-REGISTRY.md
// ──────────────────────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

// ─── Parameters ─────────────────────────────────────────────────────────────

@description('Deployment location for the router')
param location string = 'eastus2'

@description('Object ID of the owner/operator (reserved for future RBAC assignments)')
#disable-next-line no-unused-params
param userPrincipalId string

@description('Create/update the GraphOAuth Bot Service connection. Set true only on first deploy or when scopes change.')
param createOAuthConnection bool = false

@description('Low Cost Dev Mode — 7-day log retention (minimum for PerGB2018), 0.1 GB/day ingestion cap, minimal App Insights sampling. (#303)')
param lowCostDevMode bool = false

@description('Client ID of the HelkinSwarm-DelegatedAuth Entra app for user-delegated Graph access.')
param delegatedAuthClientId string = 'd4e5cf74-9f99-4504-b4ab-d4516dd10577'

@secure()
@description('Client secret for the DelegatedAuth Entra app. Only required when createOAuthConnection=true.')
param delegatedAuthClientSecret string = ''

// ─── Variables ──────────────────────────────────────────────────────────────

var routerUamiName = 'helkinswarm-id-router'
var routerFuncName = 'helkinswarm-router'
var routerStName   = 'helkinswarmrouterst'
var routerCaeName  = 'helkinswarm-cae-router'
var routerAcrName  = 'helkinswarmrouteracr'
var routerBotName  = 'helkinswarm-router-bot'
var routerLawName  = 'helkinswarm-law-router'
var routerAppiName = 'helkinswarm-appi-router'

// Built-in ARM role definition IDs
var roleStorageBlobDataOwner    = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var roleStorageQueueContributor = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var roleStorageTableContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var roleAcrPull                 = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// Low Cost Dev Mode derived values (#303, #341)
// The router uses a paid Log Analytics workspace as well, so retention stays at
// the minimum valid 30 days and low-cost savings come from cap/sampling/scale.
var routerLawRetentionDays  = 30
var routerLawDailyCapGb     = lowCostDevMode ? json('0.1') : json('-1')
var routerAppInsSamplingPct = lowCostDevMode ? 10 : 100
var routerMinReplicas       = lowCostDevMode ? 0  : 1

// ═══════════════════════════════════════════════════════════════════════════
//  1. USER-ASSIGNED MANAGED IDENTITY (global bot identity — fresh, not Alpha)
// ═══════════════════════════════════════════════════════════════════════════

resource routerUami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: routerUamiName
  location: location
}

// ═══════════════════════════════════════════════════════════════════════════
//  1b. OBSERVABILITY — Log Analytics + Application Insights
// ═══════════════════════════════════════════════════════════════════════════

resource routerLaw 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: routerLawName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: routerLawRetentionDays
    workspaceCapping: {
      dailyQuotaGb: routerLawDailyCapGb
    }
  }
}

resource routerAppi 'Microsoft.Insights/components@2020-02-02' = {
  name: routerAppiName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: routerLaw.id
    SamplingPercentage: routerAppInsSamplingPct
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. STORAGE (Consumption plan requires storage; UAMI auth, no key exposure)
// ═══════════════════════════════════════════════════════════════════════════

resource routerStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: routerStName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false   // #212 Phase 1 — force AAD-only auth, no storage keys
    networkAcls: {
      defaultAction: 'Allow'      // Phase 2 will change to 'Deny' after VNet integration
      bypass: 'AzureServices'
    }
  }
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(routerStorage.id, routerUami.id, roleStorageBlobDataOwner)
  scope: routerStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageBlobDataOwner)
    principalId: routerUami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource queueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(routerStorage.id, routerUami.id, roleStorageQueueContributor)
  scope: routerStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageQueueContributor)
    principalId: routerUami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource tableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(routerStorage.id, routerUami.id, roleStorageTableContributor)
  scope: routerStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageTableContributor)
    principalId: routerUami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. AZURE CONTAINER REGISTRY (router Docker image)
// ═══════════════════════════════════════════════════════════════════════════

resource routerAcr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: routerAcrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(routerAcr.id, routerUami.id, roleAcrPull)
  scope: routerAcr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAcrPull)
    principalId: routerUami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. CONTAINER APPS MANAGED ENVIRONMENT
//     Uses Consumption workload profile — no Dynamic VM quota needed.
// ═══════════════════════════════════════════════════════════════════════════

resource routerCae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: routerCaeName
  location: location
  properties: {
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. FUNCTION APP (Node 22 LTS, Container Apps native — Microsoft.App/containerApps)
//
//     Migrated from Microsoft.Web/sites to Microsoft.App/containerApps
//     with kind='functionapp'. This gives us native Container Apps revision
//     management (single revision mode zero-downtime rollout) instead of the
//     in-place PATCH that caused the #226/#235 rollout outage.
//
//     Ref: https://learn.microsoft.com/azure/container-apps/functions-overview
// ═══════════════════════════════════════════════════════════════════════════

resource routerFunc 'Microsoft.App/containerApps@2024-03-01' = {
  name: routerFuncName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${routerUami.id}': {}
    }
  }
  properties: {
    environmentId: routerCae.id
    workloadProfileName: 'Consumption'
    configuration: {
      // Single revision mode: platform keeps old revision serving until new one is ready.
      // This is the primary zero-downtime guarantee for image rollouts (#235).
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 80
        transport: 'auto'
        allowInsecure: false
      }
      // ACR pull via UAMI — no admin credentials, no secrets
      registries: [
        {
          server: routerAcr.properties.loginServer
          identity: routerUami.id
        }
      ]
    }
    template: {
      // MCR placeholder on initial Bicep create — deploy-code workflow updates the image
      // via `az containerapp update --image` after build-and-push completes.
      containers: [
        {
          name: 'helkinswarm-router'
          image: 'mcr.microsoft.com/azure-functions/node:4-node20-appservice'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            // Managed identity storage auth — no key exposure
            { name: 'AzureWebJobsStorage__accountName', value: routerStorage.name }
            { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
            { name: 'AzureWebJobsStorage__clientId', value: routerUami.properties.clientId }
            { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
            { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
            { name: 'AzureWebJobsFeatureFlags', value: 'EnableWorkerIndexing' }
            // Bot Framework auth — router UAMI is the single global Teams bot identity
            { name: 'MicrosoftAppId', value: routerUami.properties.clientId }
            { name: 'MicrosoftAppType', value: 'UserAssignedMSI' }
            { name: 'MicrosoftAppTenantId', value: subscription().tenantId }
            // Observability
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: routerAppi.properties.ConnectionString }
          ]
        }
      ]
      scale: {
        minReplicas: routerMinReplicas
        maxReplicas: 3
      }
    }
  }
  dependsOn: [blobRole, queueRole, tableRole, acrPullRole]
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. BOT SERVICE + TEAMS CHANNEL (global — this is the ONE Teams entry point)
//     All stamps are reached by proxy through this router.
// ═══════════════════════════════════════════════════════════════════════════

resource routerBot 'Microsoft.BotService/botServices@2022-09-15' = {
  name: routerBotName
  location: 'global'
  sku: { name: 'F0' }
  kind: 'azurebot'
  properties: {
    displayName: 'HelkinSwarm'
    endpoint: 'https://${routerFuncName}.${routerCae.properties.defaultDomain}/api/messages'
    msaAppId: routerUami.properties.clientId
    msaAppType: 'UserAssignedMSI'
    msaAppMSIResourceId: routerUami.id
    msaAppTenantId: subscription().tenantId
  }
}

resource teamsChannel 'Microsoft.BotService/botServices/channels@2022-09-15' = {
  parent: routerBot
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
  parent: routerBot
  name: 'GraphOAuth'
  location: 'global'
  properties: {
    serviceProviderDisplayName: 'Azure Active Directory v2'
    serviceProviderId: '30dd229c-58e3-4a48-bdfd-91ec48eb906c'
    clientId: delegatedAuthClientId
    clientSecret: delegatedAuthClientSecret
    scopes: 'User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite offline_access'
    parameters: [
      { key: 'tenantID', value: subscription().tenantId }
      { key: 'clientId', value: delegatedAuthClientId }
      { key: 'clientSecret', value: delegatedAuthClientSecret }
      { key: 'scopes', value: 'User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite offline_access' }
    ]
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  OUTPUTS
// ═══════════════════════════════════════════════════════════════════════════

// Stable ingress FQDN: {app-name}.{managed-env-default-domain}
// latestRevisionFqdn is the per-revision URL; the stable app URL uses env defaultDomain.
var routerFqdn = '${routerFuncName}.${routerCae.properties.defaultDomain}'

output routerEndpoint string = 'https://${routerFqdn}/api/messages'
output routerHostName string = routerFqdn
output routerFunctionAppName string = routerFunc.name
output routerAcrName string = routerAcr.name
output routerAcrLoginServer string = routerAcr.properties.loginServer
// routerUamiClientId is the global bot identity — stamp Bicep deploy needs this as routerBotId param
output routerUamiClientId string = routerUami.properties.clientId
output routerUamiResourceId string = routerUami.id
