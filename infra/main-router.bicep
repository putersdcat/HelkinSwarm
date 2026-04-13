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

@description('Low Cost Dev Mode — keeps the global router warm while reducing observability spend via ingestion cap + sampling. (#303, #410, #442)')
param lowCostDevMode bool = false

@description('Owner email for router cost-budget notifications while the furious-development-phase guard is active.')
param alertEmail string = ''

@description('Early Dev Cost Guard — source-controlled router cost lockdown for the furious development phase. While true, the router must not recreate paid LAW/App Insights by default until the owner explicitly authorizes removal. (#580)')
param earlyDevCostGuard bool = true

@description('Monthly Azure spend ceiling in USD for the router resource group while the early dev cost guard is active. Default: 10 USD.')
@minValue(1)
param earlyDevMonthlyBudgetUsd int = 10

@description('Budget start date for the router early-dev cost guard. Defaults to the first day of the current UTC month.')
param earlyDevBudgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')

@description('Client ID of the HelkinSwarm-DelegatedAuth Entra app for user-delegated Graph access.')
param delegatedAuthClientId string = 'd4e5cf74-9f99-4504-b4ab-d4516dd10577'

@secure()
@description('Client secret for the DelegatedAuth Entra app. Only required when createOAuthConnection=true.')
param delegatedAuthClientSecret string = ''

@secure()
@description('Full JSON blob for the router user-map (UserMap schema). Read from Key Vault helkinswarm-kv-a7f2 secret HelkinUserMap at deploy time. Falls back to baked-in config/user-map.json when empty (template only — no live routing). Issue: #642.')
param helkinUserMap string = ''

// ─── Variables ──────────────────────────────────────────────────────────────

var routerUamiName = 'helkinswarm-id-router'
var routerFuncName = 'helkinswarm-router'
var routerStName   = 'helkinswarmrouterst'
var routerCaeName  = 'helkinswarm-cae-router'
var routerAcrName  = 'helkinswarmrouteracr'
var routerBotName  = 'helkinswarm-router-bot'
var routerLawName  = 'helkinswarm-law-router'
var routerAppiName = 'helkinswarm-appi-router'
var routerBudgetName = 'helkinswarm-earlydev-budget-router'

// Built-in ARM role definition IDs
var roleStorageBlobDataOwner    = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var roleStorageQueueContributor = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var roleStorageTableContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var roleAcrPull                 = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// Low Cost Dev Mode derived values (#303, #341, #410, #442)
// The router is the global Teams ingress front door. Letting it scale to zero
// recreates the exact no-visible-artifact failure family where the first human
// turn can vanish before the user stamp sees any /api/messages request at all.
// Keep the router warm even in low-cost mode; save money via cap/sampling only.
var routerLawRetentionDays  = 30
var effectiveRouterLowCostDevMode = !earlyDevCostGuard && lowCostDevMode
var routerLawDailyCapGb     = effectiveRouterLowCostDevMode ? json('0.1') : json('-1')
var routerAppInsSamplingPct = effectiveRouterLowCostDevMode ? 10 : 100
var routerMinReplicas       = 1
var routerLogsDestination   = earlyDevCostGuard ? 'azure-monitor' : 'log-analytics'

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

resource routerLaw 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (!earlyDevCostGuard) {
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

resource routerAppi 'Microsoft.Insights/components@2020-02-02' = if (!earlyDevCostGuard) {
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
    appLogsConfiguration: earlyDevCostGuard
      ? {
          destination: routerLogsDestination
        }
      : {
          destination: routerLogsDestination
          logAnalyticsConfiguration: {
            customerId: routerLaw!.properties.customerId
            sharedKey: routerLaw!.listKeys().primarySharedKey
          }
        }
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
          env: concat([
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
            { name: 'DIRTY_DEV_MODE', value: string(earlyDevCostGuard) }
            { name: 'EARLY_DEV_COST_GUARD', value: string(earlyDevCostGuard) }
            // User routing map — injected as JSON from Key Vault so real user data is never
            // committed to the repo. Falls back to baked-in template when empty (#642).
            { name: 'HELKIN_USER_MAP', value: helkinUserMap }
            { name: 'DEV_TELEMETRY_MODE', value: 'minimal' }
            { name: 'AzureFunctionsJobHost__logging__logLevel__Host.Aggregator', value: 'Warning' }
            { name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Core', value: 'Warning' }
            { name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Core.1', value: 'Warning' }
            { name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Identity', value: 'Warning' }
            { name: 'AzureFunctionsJobHost__logging__logLevel__Azure.Identity.1', value: 'Warning' }
            { name: 'AzureFunctionsJobHost__logging__logLevel__DurableTask.AzureStorage', value: 'Warning' }
            { name: 'AzureFunctionsJobHost__logging__logLevel__Host.Triggers.DurableTask', value: 'Warning' }
          ], earlyDevCostGuard ? [] : [
            // Observability
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: routerAppi!.properties.ConnectionString }
          ])
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

resource routerBudget 'Microsoft.Consumption/budgets@2024-08-01' = if (earlyDevCostGuard && alertEmail != '') {
  scope: resourceGroup()
  name: routerBudgetName
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
        contactEmails: [ alertEmail ]
        contactRoles: []
        contactGroups: []
        locale: 'en-us'
      }
      Actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [ alertEmail ]
        contactRoles: []
        contactGroups: []
        locale: 'en-us'
      }
      Forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [ alertEmail ]
        contactRoles: []
        contactGroups: []
        locale: 'en-us'
      }
    }
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
output routerBudgetName string = earlyDevCostGuard && alertEmail != '' ? routerBudget.name : ''
