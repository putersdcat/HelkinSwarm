// ──────────────────────────────────────────────────────────────────────────────
// HelkinSwarm — Global Router Infrastructure
// Single Azure Function App on Consumption plan that routes Teams activities
// to user-specific stamps by aadObjectId → user-map.json lookup.
//
// Deployed once, globally. Not per-stamp.
// Resource group: rg-helkinswarm-router
//
// @see docs/0q-Multi-Instance-Architecture.md
// ──────────────────────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

// ─── Parameters ─────────────────────────────────────────────────────────────

@description('Deployment location for the router')
param location string = 'eastus2'

@description('Client ID of the UAMI used as Bot msaAppId')
param botAppId string

@description('Tenant ID for the Bot registration')
param tenantId string

// ─── Variables ──────────────────────────────────────────────────────────────

var routerFuncName = 'helkinswarm-router'
var routerStName   = 'helkinswarmrouterst'  // Storage for Consumption plan
var routerPlanName = 'helkinswarm-router-plan'
var routerBotName  = 'helkinswarm-router-bot'

// ═══════════════════════════════════════════════════════════════════════════
//  1. STORAGE ACCOUNT (required for Consumption plan)
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

// ═══════════════════════════════════════════════════════════════════════════
//  2. APP SERVICE PLAN (Consumption / Y1)
// ═══════════════════════════════════════════════════════════════════════════

resource routerPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: routerPlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true  // Linux
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. FUNCTION APP (Node 22 LTS, Consumption)
// ═══════════════════════════════════════════════════════════════════════════

resource routerFunc 'Microsoft.Web/sites@2023-12-01' = {
  name: routerFuncName
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: routerPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${routerStorage.name};AccountKey=${routerStorage.listKeys().keys[0].value}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'MicrosoftAppId', value: botAppId }
        { name: 'MicrosoftAppType', value: 'UserAssignedMSI' }
        { name: 'MicrosoftAppTenantId', value: tenantId }
      ]
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. BOT SERVICE (points to router as the messaging endpoint)
// ═══════════════════════════════════════════════════════════════════════════

resource routerBot 'Microsoft.BotService/botServices@2023-09-15-preview' = {
  name: routerBotName
  location: 'global'
  sku: { name: 'F0' }
  kind: 'azurebot'
  properties: {
    displayName: 'HelkinSwarm Router'
    endpoint: 'https://${routerFunc.properties.defaultHostName}/api/messages'
    msaAppId: botAppId
    msaAppType: 'UserAssignedMSI'
    msaAppTenantId: tenantId
    msaAppMSIResourceId: '' // Router uses the same UAMI as stamps
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  OUTPUTS
// ═══════════════════════════════════════════════════════════════════════════

output routerEndpoint string = 'https://${routerFunc.properties.defaultHostName}/api/messages'
output routerHostName string = routerFunc.properties.defaultHostName
output routerFunctionAppName string = routerFunc.name
