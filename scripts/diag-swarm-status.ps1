$ErrorActionPreference = 'Stop'
$cosmosUrl = 'https://helkinswarm-cosmos-a7f2.documents.azure.com'
$healthUrl = 'https://helkinswarm-func-a7f2.purplepebble-508e1162.eastus2.azurecontainerapps.io/api/health'

$token = (az account get-access-token --resource $cosmosUrl --query accessToken -o tsv)
$auth = [Uri]::EscapeDataString("type=aad&ver=1.0&sig=$token")
$headers = @{
  'Authorization' = $auth
  'x-ms-version' = '2018-12-31'
  'x-ms-date' = (Get-Date).ToUniversalTime().ToString('R')
  'Content-Type' = 'application/query+json'
  'x-ms-documentdb-isquery' = 'True'
  'x-ms-documentdb-query-enablecrosspartition' = 'True'
  'x-ms-max-item-count' = '30'
}
$body = '{"query":"SELECT c.id, c.executedAt, c.status, c.success, c.executionDurationMs, c.agentCount, c.persistenceWarning, c.swarmId FROM c WHERE c.type=\"swarm-execution\""}'
$r = Invoke-RestMethod -Method Post -Uri "$cosmosUrl/dbs/helkinswarm/colls/sessions/docs" -Headers $headers -Body $body

"=== Swarm rows: $($r.Documents.Count) total ==="
$r.Documents | Sort-Object executedAt -Descending | Select-Object -First 5 | ForEach-Object {
  '{0,-25} {1,-9} dur={2,-7} agents={3} warn={4}' -f $_.executedAt, $_.status, $_.executionDurationMs, $_.agentCount, ($_.persistenceWarning ?? '-')
}

"`n=== Health diagnostics ==="
$h = Invoke-RestMethod $healthUrl
"orchestrator activeTurns: $($h.diagnostics.orchestrator.activeTurns)"
$h.diagnostics.orchestrator.turns | ForEach-Object {
  "  stage=$($_.stage) ageMs=$($_.ageMs) corr=$($_.correlationId.Substring(0,8))"
}
"swarmAudit lastPersistedAt: $($h.diagnostics.swarmAudit.lastPersistedAt)"
"swarmAudit lastSuccessfulPersistedAt: $($h.diagnostics.swarmAudit.lastSuccessfulPersistedAt)"
"swarmAudit staleRunningCount: $($h.diagnostics.swarmAudit.staleRunningCount)"
