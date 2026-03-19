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

// ─── Variables ──────────────────────────────────────────────────────────────

var routerUamiName = 'helkinswarm-id-router'
var routerFuncName = 'helkinswarm-router'
var routerStName   = 'helkinswarmrouterst'
var routerCaeName  = 'helkinswarm-cae-router'
var routerAcrName  = 'helkinswarmrouteracr'
var routerBotName  = 'helkinswarm-router-bot'

// Built-in ARM role definition IDs
var roleStorageBlobDataOwner    = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var roleStorageQueueContributor = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var roleStorageTableContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var roleAcrPull                 = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// ═══════════════════════════════════════════════════════════════════════════
//  1. USER-ASSIGNED MANAGED IDENTITY (global bot identity — fresh, not Alpha)
// ═══════════════════════════════════════════════════════════════════════════

resource routerUami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: routerUamiName
  location: location
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
//  5. FUNCTION APP (Node 22 LTS, Container Apps, router UAMI assigned)
// ═══════════════════════════════════════════════════════════════════════════

resource routerFunc 'Microsoft.Web/sites@2023-12-01' = {
  name: routerFuncName
  location: location
  kind: 'functionapp,linux,container'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${routerUami.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: routerCae.id
    httpsOnly: true
    siteConfig: {
      minimumElasticInstanceCount: 1
      functionAppScaleLimit: 3
      // MCR placeholder removed — use router ACR URL from the start (matches stamp pattern).
      // Container won't start until deploy-code pushes the first image; that is expected.
      linuxFxVersion: 'DOCKER|${routerAcr.properties.loginServer}/helkinswarm-router:latest'
      acrUseManagedIdentityCreds: true
      acrUserManagedIdentityID: routerUami.id
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
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
      ]
    }
  }
  dependsOn: [blobRole, queueRole, tableRole]
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
    endpoint: 'https://${routerFunc.properties.defaultHostName}/api/messages'
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

// ═══════════════════════════════════════════════════════════════════════════
//  OUTPUTS
// ═══════════════════════════════════════════════════════════════════════════

output routerEndpoint string = 'https://${routerFunc.properties.defaultHostName}/api/messages'
output routerHostName string = routerFunc.properties.defaultHostName
output routerFunctionAppName string = routerFunc.name
output routerAcrName string = routerAcr.name
output routerAcrLoginServer string = routerAcr.properties.loginServer
// routerUamiClientId is the global bot identity — stamp Bicep deploy needs this as routerBotId param
output routerUamiClientId string = routerUami.properties.clientId
output routerUamiResourceId string = routerUami.id
