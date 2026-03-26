#requires -Modules Az.Accounts

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9]{4}$')]
  [string]$UserAlias,

  [Parameter(Mandatory = $true)]
  [string]$CorrelationTag,

  [Parameter()]
  [switch]$PassThru,

  [Parameter()]
  [ValidateSet('Json', 'Object')]
  [string]$OutputFormat = 'Json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Path $PSScriptRoot -Parent
$userMapPath = Join-Path $repoRoot 'config/user-map.json'
if (-not (Test-Path -Path $userMapPath)) {
  throw "Could not find user map at $userMapPath"
}

$userMap = Get-Content -Path $userMapPath -Raw | ConvertFrom-Json
$userEntry = $null
$userObjectId = $null
foreach ($property in $userMap.users.PSObject.Properties) {
  if ($property.Value.alias -eq $UserAlias) {
    $userEntry = $property.Value
    $userObjectId = $property.Name
    break
  }
}

if (-not $userEntry) {
  throw "Could not find enabled user-map entry for alias '$UserAlias'."
}

$baseEndpoint = [string]$userEntry.endpoint
if ([string]::IsNullOrWhiteSpace($baseEndpoint)) {
  throw "User map entry for alias '$UserAlias' is missing endpoint."
}
$baseEndpoint = $baseEndpoint -replace '/api/messages/?$', ''

$resourceGroupName = "rg-helkinswarm-$UserAlias"
$functionAppName = "helkinswarm-func-$UserAlias"
$functionName = 'devloopSessionBundle'

$keyJson = az functionapp function keys list `
  --resource-group $resourceGroupName `
  --name $functionAppName `
  --function-name $functionName `
  --output json | ConvertFrom-Json

$functionKey = $keyJson.default
if ([string]::IsNullOrWhiteSpace($functionKey)) {
  throw "Could not resolve a default function key for $functionName on $functionAppName."
}

$encodedCorrelationTag = [System.Uri]::EscapeDataString($CorrelationTag)
$uri = "$baseEndpoint/api/devloop/session-bundle/${encodedCorrelationTag}?code=$functionKey"

$result = [pscustomobject]@{
  metadata = [pscustomobject]@{
    userAlias = $UserAlias
    functionAppName = $functionAppName
    resourceGroupName = $resourceGroupName
    functionName = $functionName
    endpoint = $uri
    ownerObjectId = [string]$userObjectId
  }
  bundle = (Invoke-RestMethod -Method Get -Uri $uri -Headers @{
  'x-helkinswarm-user-id' = [string]$userObjectId
  })
}

if ($PassThru -or $OutputFormat -eq 'Object') {
  return $result
}

$result | ConvertTo-Json -Depth 12