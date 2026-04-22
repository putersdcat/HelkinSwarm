param([Parameter(Mandatory)][string]$Match)
$ErrorActionPreference = 'Stop'
$cosmosUrl = 'https://helkinswarm-cosmos-a7f2.documents.azure.com'
$token = (az account get-access-token --resource $cosmosUrl --query accessToken -o tsv)
$auth = [Uri]::EscapeDataString("type=aad&ver=1.0&sig=$token")
$headers = @{
  'Authorization' = $auth
  'x-ms-version' = '2018-12-31'
  'x-ms-date' = (Get-Date).ToUniversalTime().ToString('R')
  'Content-Type' = 'application/query+json'
  'x-ms-documentdb-isquery' = 'True'
  'x-ms-documentdb-query-enablecrosspartition' = 'True'
  'x-ms-max-item-count' = '5'
}
$q = @{ query = "SELECT * FROM c WHERE c.type='swarm-execution' AND (CONTAINS(c.id, @m) OR CONTAINS(c.swarmId, @m) OR CONTAINS(c.correlationId, @m))"; parameters = @(@{ name='@m'; value=$Match }) } | ConvertTo-Json -Depth 5 -Compress
$r = Invoke-RestMethod -Method Post -Uri "$cosmosUrl/dbs/helkinswarm/colls/sessions/docs" -Headers $headers -Body $q
$r.Documents | ConvertTo-Json -Depth 12
