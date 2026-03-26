#requires -Modules Az.Accounts

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9]{4}$')]
  [string]$UserAlias,

  [Parameter()]
  [string]$ResourceGroupName,

  [Parameter()]
  [string]$AiServicesName,

  [Parameter()]
  [int]$LowCapacityThreshold = 1,

  [Parameter()]
  [ValidateSet('Json', 'Table')]
  [string]$OutputFormat = 'Json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ResourceGroupName) {
  $ResourceGroupName = "rg-helkinswarm-$UserAlias"
}

if (-not $AiServicesName) {
  $AiServicesName = "helkinswarm-ai-$UserAlias"
}

$deploymentsJson = az cognitiveservices account deployment list `
  --name $AiServicesName `
  --resource-group $ResourceGroupName `
  --output json

$deployments = $deploymentsJson | ConvertFrom-Json
if ($null -eq $deployments) {
  $deployments = @()
}

$rows = @($deployments | ForEach-Object {
  [pscustomobject]@{
    DeploymentName = $_.name
    SkuName = $_.sku.name
    Capacity = [int]($_.sku.capacity ?? 0)
    ProvisioningState = $_.properties.provisioningState
    ModelName = $_.properties.model.name
    ModelVersion = $_.properties.model.version
    ModelFormat = $_.properties.model.format
  }
})

$summary = [pscustomobject]@{
  userAlias = $UserAlias
  resourceGroupName = $ResourceGroupName
  aiServicesName = $AiServicesName
  deploymentCount = @($rows).Count
  lowCapacityThreshold = $LowCapacityThreshold
  lowCapacityDeployments = @($rows | Where-Object { $_.Capacity -le $LowCapacityThreshold })
  totalRequestedCapacity = (@($rows | Measure-Object -Property Capacity -Sum).Sum ?? 0)
}

$result = [pscustomobject]@{
  summary = $summary
  deployments = @($rows)
}

if ($OutputFormat -eq 'Table') {
  $rows | Sort-Object DeploymentName | Format-Table -AutoSize | Out-String | Write-Host
  return
}

$result | ConvertTo-Json -Depth 8
