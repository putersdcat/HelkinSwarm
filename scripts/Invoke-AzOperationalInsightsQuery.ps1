#requires -Modules Az.OperationalInsights, Az.Resources

[CmdletBinding(DefaultParameterSetName = 'ByAlias')]
param(
  [Parameter(ParameterSetName = 'ByAlias')]
  [ValidatePattern('^[a-z0-9]{4}$')]
  [string]$UserAlias,

  [Parameter(ParameterSetName = 'ByRouter')]
  [switch]$Router,

  [Parameter(ParameterSetName = 'ByName', Mandatory = $true)]
  [string]$AppInsightsName,

  [Parameter(ParameterSetName = 'ByName', Mandatory = $true)]
  [string]$ResourceGroupName,

  [Parameter(ParameterSetName = 'ByWorkspace', Mandatory = $true)]
  [string]$WorkspaceId,

  [Parameter(Mandatory = $true)]
  [string]$Query,

  [Parameter()]
  [string]$Timespan = '01:00:00',

  [Parameter()]
  [int]$Top = 200,

  [Parameter()]
  [switch]$IncludeRender,

  [Parameter()]
  [switch]$IncludeStatistics,

  [Parameter()]
  [switch]$PassThru,

  [Parameter()]
  [ValidateSet('Auto', 'Table', 'Json')]
  [string]$OutputFormat = 'Auto'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-WorkspaceId {
  param(
    [string]$ResolvedWorkspaceId,
    [string]$ResolvedAppInsightsName,
    [string]$ResolvedResourceGroupName
  )

  if ($ResolvedWorkspaceId) {
    return $ResolvedWorkspaceId
  }

  if (-not $ResolvedAppInsightsName -or -not $ResolvedResourceGroupName) {
    throw 'Either -WorkspaceId or an Application Insights resource identity is required.'
  }

  $appInsights = Get-AzResource `
    -ResourceGroupName $ResolvedResourceGroupName `
    -Name $ResolvedAppInsightsName `
    -ResourceType 'Microsoft.Insights/components' `
    -ExpandProperties

  $workspaceResourceId = $appInsights.Properties.WorkspaceResourceId
  if (-not $workspaceResourceId) {
    throw "Application Insights '$ResolvedAppInsightsName' in '$ResolvedResourceGroupName' is not workspace-based."
  }

  $segments = $workspaceResourceId.Trim('/').Split('/')
  if ($segments.Length -lt 8) {
    throw "Could not parse WorkspaceResourceId: $workspaceResourceId"
  }

  $workspaceResourceGroup = $segments[3]
  $workspaceName = $segments[7]
  $workspace = Get-AzOperationalInsightsWorkspace -ResourceGroupName $workspaceResourceGroup -Name $workspaceName
  return [string]$workspace.CustomerId
}

function Resolve-AppInsightsIdentity {
  switch ($PSCmdlet.ParameterSetName) {
    'ByAlias' {
      if (-not $UserAlias) {
        throw 'UserAlias is required for the ByAlias parameter set.'
      }

      return @{
        AppInsightsName = "helkinswarm-appi-$UserAlias"
        ResourceGroupName = "rg-helkinswarm-$UserAlias"
      }
    }
    'ByRouter' {
      return @{
        AppInsightsName = 'helkinswarm-appi-router'
        ResourceGroupName = 'rg-helkinswarm-router'
      }
    }
    'ByName' {
      return @{
        AppInsightsName = $AppInsightsName
        ResourceGroupName = $ResourceGroupName
      }
    }
    default {
      return @{
        AppInsightsName = $null
        ResourceGroupName = $null
      }
    }
  }
}

function Convert-ToTimespan {
  param([string]$InputValue)

  if ([string]::IsNullOrWhiteSpace($InputValue)) {
    return [TimeSpan]::FromHours(1)
  }

  try {
    return [TimeSpan]::Parse($InputValue)
  } catch {
    throw "Invalid -Timespan '$InputValue'. Use a .NET TimeSpan value such as 00:30:00 or 1.00:00:00."
  }
}

$identity = Resolve-AppInsightsIdentity
$resolvedWorkspaceId = Resolve-WorkspaceId `
  -ResolvedWorkspaceId $WorkspaceId `
  -ResolvedAppInsightsName $identity.AppInsightsName `
  -ResolvedResourceGroupName $identity.ResourceGroupName

$queryText = if ($Top -gt 0 -and $Query -notmatch '(?i)\|\s*take\s+\d+') {
  "$Query`n| take $Top"
} else {
  $Query
}

$invokeParams = @{
  WorkspaceId = $resolvedWorkspaceId
  Query = $queryText
  Timespan = (Convert-ToTimespan -InputValue $Timespan)
}

if ($IncludeRender) {
  $invokeParams['IncludeRender'] = $true
}

if ($IncludeStatistics) {
  $invokeParams['IncludeStatistics'] = $true
}

$result = Invoke-AzOperationalInsightsQuery @invokeParams

$metadata = [pscustomobject]@{
  WorkspaceId = $resolvedWorkspaceId
  AppInsightsName = $identity.AppInsightsName
  ResourceGroupName = $identity.ResourceGroupName
  Timespan = $Timespan
  Query = $queryText
}

if ($PassThru) {
  [pscustomobject]@{
    Metadata = $metadata
    Result = $result
  }
  return
}

Write-Host "WorkspaceId: $($metadata.WorkspaceId)"
if ($metadata.AppInsightsName) {
  Write-Host "AppInsights: $($metadata.AppInsightsName) [$($metadata.ResourceGroupName)]"
}
Write-Host "Timespan: $($metadata.Timespan)"
Write-Host '---'

if ($OutputFormat -eq 'Json') {
  [pscustomobject]@{
    metadata = $metadata
    tables = $result.Results
    statistics = $result.Statistics
    render = $result.Render
    error = $result.Error
  } | ConvertTo-Json -Depth 12
  return
}

if ($result.Error) {
  Write-Warning ($result.Error | Out-String)
}

if (-not $result.Results -or $result.Results.Count -eq 0) {
  Write-Host 'No rows returned.'
  return
}

if ($OutputFormat -eq 'Table' -or $OutputFormat -eq 'Auto') {
  $result.Results | Format-Table -AutoSize | Out-String | Write-Host
}

if ($IncludeStatistics -and $result.Statistics) {
  Write-Host 'Statistics:'
  $result.Statistics | ConvertTo-Json -Depth 10 | Write-Host
}

if ($IncludeRender -and $result.Render) {
  Write-Host 'Render:'
  $result.Render | ConvertTo-Json -Depth 10 | Write-Host
}