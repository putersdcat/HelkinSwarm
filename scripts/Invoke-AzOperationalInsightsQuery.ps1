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
  [ValidateSet('Workspace', 'AppInsights')]
  [string]$QueryScope = 'Workspace',

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

function Invoke-ClassicAppInsightsQuery {
  param(
    [string]$ResolvedAppInsightsName,
    [string]$ResolvedResourceGroupName,
    [string]$AnalyticsQuery,
    [string]$RequestedTimespan
  )

  if (-not $ResolvedAppInsightsName -or -not $ResolvedResourceGroupName) {
    throw 'AppInsights query scope requires an Application Insights name and resource group.'
  }

  $json = az monitor app-insights query `
    --app $ResolvedAppInsightsName `
    --resource-group $ResolvedResourceGroupName `
    --analytics-query $AnalyticsQuery `
    --offset (Convert-ToAppInsightsOffset -InputValue $RequestedTimespan) `
    -o json

  if ([string]::IsNullOrWhiteSpace($json)) {
    return [pscustomobject]@{ tables = @() }
  }

  return ($json | ConvertFrom-Json -Depth 20)
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

function Convert-ToAppInsightsOffset {
  param([string]$InputValue)

  $span = Convert-ToTimespan -InputValue $InputValue
  if ($span.Days -gt 0) {
    return ('{0}d' -f [int]$span.TotalDays)
  }

  if ($span.Hours -gt 0 -and $span.Minutes -eq 0 -and $span.Seconds -eq 0) {
    return ('{0}h' -f [int]$span.TotalHours)
  }

  if ($span.Hours -gt 0) {
    return ('{0}h{1}m' -f [int]$span.TotalHours, $span.Minutes)
  }

  if ($span.Minutes -gt 0 -and $span.Seconds -eq 0) {
    return ('{0}m' -f [int]$span.TotalMinutes)
  }

  if ($span.Minutes -gt 0) {
    return ('{0}m' -f [int][Math]::Ceiling($span.TotalMinutes))
  }

  return ('{0}m' -f [Math]::Max([int][Math]::Ceiling($span.TotalSeconds / 60), 1))
}

$identity = Resolve-AppInsightsIdentity
$resolvedWorkspaceId = if ($QueryScope -eq 'Workspace') {
  Resolve-WorkspaceId `
    -ResolvedWorkspaceId $WorkspaceId `
    -ResolvedAppInsightsName $identity.AppInsightsName `
    -ResolvedResourceGroupName $identity.ResourceGroupName
} else {
  $null
}

$queryText = if ($Top -gt 0 -and $Query -notmatch '(?i)\|\s*take\s+\d+') {
  "$Query`n| take $Top"
} else {
  $Query
}

$result = if ($QueryScope -eq 'Workspace') {
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

  Invoke-AzOperationalInsightsQuery @invokeParams
} else {
  Invoke-ClassicAppInsightsQuery `
    -ResolvedAppInsightsName $identity.AppInsightsName `
    -ResolvedResourceGroupName $identity.ResourceGroupName `
    -AnalyticsQuery $queryText `
    -RequestedTimespan $Timespan
}

$metadata = [pscustomobject]@{
  WorkspaceId = $resolvedWorkspaceId
  AppInsightsName = $identity.AppInsightsName
  ResourceGroupName = $identity.ResourceGroupName
  Timespan = $Timespan
  Query = $queryText
  QueryScope = $QueryScope
}

if ($PassThru) {
  [pscustomobject]@{
    Metadata = $metadata
    Result = $result
  }
  return
}

if ($OutputFormat -eq 'Json') {
  [pscustomobject]@{
    metadata = $metadata
    tables = if ($QueryScope -eq 'Workspace') { $result.Results } else { $result.tables }
    statistics = if ($QueryScope -eq 'Workspace') { $result.Statistics } else { $null }
    render = if ($QueryScope -eq 'Workspace') { $result.Render } else { $null }
    error = if ($QueryScope -eq 'Workspace') { $result.Error } else { $null }
  } | ConvertTo-Json -Depth 12
  return
}

Write-Host "WorkspaceId: $($metadata.WorkspaceId)"
if ($metadata.AppInsightsName) {
  Write-Host "AppInsights: $($metadata.AppInsightsName) [$($metadata.ResourceGroupName)]"
}
Write-Host "Timespan: $($metadata.Timespan)"
Write-Host '---'

if ($QueryScope -eq 'Workspace' -and $result.Error) {
  Write-Warning ($result.Error | Out-String)
}

if (($QueryScope -eq 'Workspace' -and (-not $result.Results -or $result.Results.Count -eq 0)) -or ($QueryScope -eq 'AppInsights' -and (-not $result.tables -or $result.tables.Count -eq 0))) {
  Write-Host 'No rows returned.'
  return
}

if ($OutputFormat -eq 'Table' -or $OutputFormat -eq 'Auto') {
  if ($QueryScope -eq 'Workspace') {
    $result.Results | Format-Table -AutoSize | Out-String | Write-Host
  } else {
    foreach ($table in @($result.tables)) {
      $rows = foreach ($row in @($table.rows)) {
        $obj = [ordered]@{}
        for ($i = 0; $i -lt $table.columns.Count; $i++) {
          $obj[$table.columns[$i].name] = $row[$i]
        }
        [pscustomobject]$obj
      }
      $rows | Format-Table -AutoSize | Out-String | Write-Host
    }
  }
}

if ($QueryScope -eq 'Workspace' -and $IncludeStatistics -and $result.Statistics) {
  Write-Host 'Statistics:'
  $result.Statistics | ConvertTo-Json -Depth 10 | Write-Host
}

if ($QueryScope -eq 'Workspace' -and $IncludeRender -and $result.Render) {
  Write-Host 'Render:'
  $result.Render | ConvertTo-Json -Depth 10 | Write-Host
}