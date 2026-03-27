targetScope = 'resourceGroup'

@description('Name of the existing Azure AI Services account that owns the model deployments.')
param aiServicesName string

@description('DEPRECATED alias for the old quota ceiling parameter. Prefer quotaMaxTPMCeiling.')
param quotaMaxTPM int = 100000

@description('Maximum TPM ceiling for AI model deployments. The summed requested deployment capacities stay within this ceiling.')
param quotaMaxTPMCeiling int = 400000

@description('Quota allocation strategy. maximize = favor higher initial deployment capacities; minimize = conservative baseline; manual = rely primarily on modelQuotaOverrides.')
@allowed([ 'maximize', 'minimize', 'manual' ])
param quotaStrategy string = 'maximize'

@description('Per-model deployment capacity overrides in 1k TPM units, keyed by deployment name (for example text-embedding-3-large = 100).')
param modelQuotaOverrides object = {}

var effectiveQuotaMaxTPM = max(quotaMaxTPM, quotaMaxTPMCeiling)
var quotaBudgetK = max(1, int(effectiveQuotaMaxTPM / 1000))

var embeddingRequested = contains(modelQuotaOverrides, 'text-embedding-3-large')
  ? int(modelQuotaOverrides['text-embedding-3-large'])
  : (quotaStrategy == 'minimize' ? 50 : quotaStrategy == 'manual' ? 100 : 100)
var grokReasoningRequested = contains(modelQuotaOverrides, 'grok-4-1-fast-reasoning')
  ? int(modelQuotaOverrides['grok-4-1-fast-reasoning'])
  : (quotaStrategy == 'minimize' ? 10 : quotaStrategy == 'manual' ? 20 : 20)
var grokFastRequested = contains(modelQuotaOverrides, 'grok-4-1-fast-non-reasoning')
  ? int(modelQuotaOverrides['grok-4-1-fast-non-reasoning'])
  : (quotaStrategy == 'minimize' ? 10 : quotaStrategy == 'manual' ? 20 : 20)
var gpt54Requested = contains(modelQuotaOverrides, 'gpt-5.4-mini')
  ? int(modelQuotaOverrides['gpt-5.4-mini'])
  : (quotaStrategy == 'minimize' ? 5 : quotaStrategy == 'manual' ? 10 : 50)  // GlobalStandard ceiling: 1000k — raised from 10 (#113)
var codexRequested = contains(modelQuotaOverrides, 'gpt-5.1-codex-mini')
  ? int(modelQuotaOverrides['gpt-5.1-codex-mini'])
  : (quotaStrategy == 'minimize' ? 5 : quotaStrategy == 'manual' ? 10 : 50)  // GlobalStandard ceiling: 1000k — raised from 10 (#113)
var o4MiniRequested = contains(modelQuotaOverrides, 'o4-mini')
  ? int(modelQuotaOverrides['o4-mini'])
  : (quotaStrategy == 'minimize' ? 5 : quotaStrategy == 'manual' ? 10 : 50)  // GlobalStandard ceiling: 1000k — raised from 10 (#113)
var fwMiniMaxRequested = contains(modelQuotaOverrides, 'FW-MiniMax-M2.5')
  ? int(modelQuotaOverrides['FW-MiniMax-M2.5'])
  : (quotaStrategy == 'minimize' ? 5 : quotaStrategy == 'manual' ? 10 : 10)
var fwKimiRequested = contains(modelQuotaOverrides, 'FW-Kimi-K2.5')
  ? int(modelQuotaOverrides['FW-Kimi-K2.5'])
  : (quotaStrategy == 'minimize' ? 5 : quotaStrategy == 'manual' ? 10 : 10)
var deepSeekRequested = contains(modelQuotaOverrides, 'DeepSeek-V3.2')
  ? int(modelQuotaOverrides['DeepSeek-V3.2'])
  : (quotaStrategy == 'minimize' ? 5 : quotaStrategy == 'manual' ? 10 : 20)  // GlobalStandard ceiling: 20k — raised from 10 (#113)

var capEmbedding = min(embeddingRequested, quotaBudgetK)
var remainingAfterEmbedding = max(0, quotaBudgetK - capEmbedding)

var capGrokReasoning = min(grokReasoningRequested, remainingAfterEmbedding)
var remainingAfterGrokReasoning = max(0, remainingAfterEmbedding - capGrokReasoning)

var capGrokFast = min(grokFastRequested, remainingAfterGrokReasoning)
var remainingAfterGrokFast = max(0, remainingAfterGrokReasoning - capGrokFast)

var capGpt54Mini = min(gpt54Requested, remainingAfterGrokFast)
var remainingAfterGpt54Mini = max(0, remainingAfterGrokFast - capGpt54Mini)

var capCodexMini = min(codexRequested, remainingAfterGpt54Mini)
var remainingAfterCodexMini = max(0, remainingAfterGpt54Mini - capCodexMini)

var capO4Mini = min(o4MiniRequested, remainingAfterCodexMini)
var remainingAfterO4Mini = max(0, remainingAfterCodexMini - capO4Mini)

var capFwMiniMax = min(fwMiniMaxRequested, remainingAfterO4Mini)
var remainingAfterFwMiniMax = max(0, remainingAfterO4Mini - capFwMiniMax)

var capFwKimi = min(fwKimiRequested, remainingAfterFwMiniMax)
var remainingAfterFwKimi = max(0, remainingAfterFwMiniMax - capFwKimi)

var capDeepSeek = min(deepSeekRequested, remainingAfterFwKimi)

resource aiServices 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: aiServicesName
}

resource aiDeployEmbedding 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: 'text-embedding-3-large'
  sku: { name: 'GlobalStandard', capacity: capEmbedding }
  properties: {
    model: { format: 'OpenAI', name: 'text-embedding-3-large', version: '1' }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource aiDeployGrokReasoning 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: 'grok-4-1-fast-reasoning'
  dependsOn: [ aiDeployEmbedding ]
  sku: { name: 'DataZoneStandard', capacity: capGrokReasoning }
  properties: {
    model: { format: 'xAI', name: 'grok-4-1-fast-reasoning', version: '1' }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource aiDeployGrokFast 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: 'grok-4-1-fast-non-reasoning'
  dependsOn: [ aiDeployGrokReasoning ]
  sku: { name: 'DataZoneStandard', capacity: capGrokFast }
  properties: {
    model: { format: 'xAI', name: 'grok-4-1-fast-non-reasoning', version: '1' }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource aiDeployGpt54Mini 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: 'gpt-5.4-mini'
  dependsOn: [ aiDeployGrokFast ]
  sku: { name: 'GlobalStandard', capacity: capGpt54Mini }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-5.4-mini', version: '2026-03-17' }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource aiDeployCodexMini 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: 'gpt-5.1-codex-mini'
  dependsOn: [ aiDeployGpt54Mini ]
  sku: { name: 'GlobalStandard', capacity: capCodexMini }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-5.1-codex-mini', version: '2025-11-13' }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource aiDeployO4Mini 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: 'o4-mini'
  dependsOn: [ aiDeployCodexMini ]
  sku: { name: 'GlobalStandard', capacity: capO4Mini }
  properties: {
    model: { format: 'OpenAI', name: 'o4-mini', version: '2025-04-16' }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource aiDeployFwMiniMax 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: 'FW-MiniMax-M2.5'
  dependsOn: [ aiDeployO4Mini ]
  sku: { name: 'DataZoneStandard', capacity: capFwMiniMax }
  properties: {
    model: { format: 'Fireworks', name: 'FW-MiniMax-M2.5', version: '1' }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource aiDeployFwKimi 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: 'FW-Kimi-K2.5'
  dependsOn: [ aiDeployFwMiniMax ]
  sku: { name: 'DataZoneStandard', capacity: capFwKimi }
  properties: {
    model: { format: 'Fireworks', name: 'FW-Kimi-K2.5', version: '1' }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource aiDeployDeepSeek 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServices
  name: 'DeepSeek-V3.2'
  dependsOn: [ aiDeployFwKimi ]
  sku: { name: 'GlobalStandard', capacity: capDeepSeek }
  properties: {
    model: { format: 'DeepSeek', name: 'DeepSeek-V3.2', version: '1' }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}
