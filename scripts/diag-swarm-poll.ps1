param([int]$IntervalSec = 30, [int]$MaxIterations = 12)
$ErrorActionPreference = 'Stop'

for ($i = 1; $i -le $MaxIterations; $i++) {
  Write-Host "`n--- Poll $i/$MaxIterations @ $((Get-Date).ToString('HH:mm:ss')) ---"
  & "$PSScriptRoot\diag-swarm-status.ps1"
  if ($i -lt $MaxIterations) { Start-Sleep -Seconds $IntervalSec }
}
