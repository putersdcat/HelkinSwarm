// ──────────────────────────────────────────────────────────────────────────────
// HelkinSwarm — Global Tab Host Infrastructure
// Azure Storage static website for the global tab SPA.
// Scale-to-zero, ~$0.001/GB — no warm-up cost.
//
// Deploy ONCE globally to rg-helkinswarm-tabs.
// The static website endpoint becomes TAB_HOST_URL for all stamps.
//
// Tab data is fetched from per-stamp Function App backends (client-side OBO).
// See docs/0o-Microsoft-Teams-App-Expansion-with-Tabs.md
// See docs/0q-Multi-Instance-Architecture.md (Tab Hosting — issue #107)
// ──────────────────────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

// ─── Parameters ─────────────────────────────────────────────────────────────

@description('Deployment location for the tab host storage')
param location string = 'eastus2'

@description('Resource ID of the global router UAMI — kept for future Router-initiated tab reads')
param routerUamiResourceId string

@description('Object ID of the CICD service principal — gets Storage Blob Data Contributor so the GitHub Actions workflow can upload SPA assets')
param cicdPrincipalId string

@description('Owner email for tab-host cost-budget notifications while the furious-development-phase guard is active.')
param alertEmail string = ''

@description('Early Dev Cost Guard — source-controlled budget/surface guard for the global tab host during the furious development phase. (#580)')
param earlyDevCostGuard bool = true

@description('Monthly Azure spend ceiling in USD for the tab-host resource group while the early dev cost guard is active. Default: 5 USD.')
@minValue(1)
param earlyDevMonthlyBudgetUsd int = 5

@description('Budget start date for the tab-host early-dev cost guard. Defaults to the first day of the current UTC month.')
param earlyDevBudgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')

// ─── Variables ──────────────────────────────────────────────────────────────

var tabsStName = 'helkinswarmtabsst'
var roleStorageBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var tabsBudgetName = 'helkinswarm-earlydev-budget-tabs'

// ═══════════════════════════════════════════════════════════════════════════
//  1. STORAGE ACCOUNT (StorageV2 + Static Website hosting)
//     Static website costs ~$0.001/GB; scales to zero when not accessed.
//     Public read on the $web container is required for Teams to load the SPA.
// ═══════════════════════════════════════════════════════════════════════════

resource tabsStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: tabsStName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    // Public network access is required for Teams to fetch the SPA.
    allowBlobPublicAccess: true
    // Anonymous read access is required for the static website endpoint.
    // All sensitive data is served from per-stamp backends (authenticated OBO — not this storage).
    publicNetworkAccess: 'Enabled'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2a. RBAC — CICD service principal uploads SPA assets during GitHub Actions
// ═══════════════════════════════════════════════════════════════════════════

resource cicdBlobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(tabsStorage.id, cicdPrincipalId, roleStorageBlobDataContributor)
  scope: tabsStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageBlobDataContributor)
    principalId: cicdPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  2b. RBAC — router UAMI retained for future Router-initiated tab reads
// ═══════════════════════════════════════════════════════════════════════════

resource routerBlobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(tabsStorage.id, routerUamiResourceId, roleStorageBlobDataContributor)
  scope: tabsStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageBlobDataContributor)
    principalId: reference(routerUamiResourceId, '2023-01-31').principalId
    principalType: 'ServicePrincipal'
  }
}

resource tabsBudget 'Microsoft.Consumption/budgets@2024-08-01' = if (earlyDevCostGuard && alertEmail != '') {
  scope: resourceGroup()
  name: tabsBudgetName
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
//  3. OUTPUTS
//     staticWebEndpoint: https://{account}.z{n}.web.core.windows.net
//     This becomes TAB_HOST_URL in the GitHub variable store.
// ═══════════════════════════════════════════════════════════════════════════

output storageAccountName string = tabsStorage.name
output storageAccountId string = tabsStorage.id
output tabsBudgetName string = earlyDevCostGuard && alertEmail != '' ? tabsBudget.name : ''
// Note: static website must be enabled via az storage blob service-properties update
// after the storage account is created (not supported as a Bicep resource property).
// The deploy-tabs.yml workflow handles this in the post-deploy step.
