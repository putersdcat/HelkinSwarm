. C:\GitRoots\HelkinSwarm\scripts\agent-login.ps1 -Quiet -AzOnly
$tok = (Get-AzAccessToken -ResourceUrl 'https://helkinswarm-cosmos-a7f2.documents.azure.com' -AsSecureString)
$rawTok = [System.Net.NetworkCredential]::new('', $tok.Token).Password
$auth = [Uri]::EscapeDataString("type=aad&ver=1.0&sig=$rawTok")
$date = (Get-Date).ToUniversalTime().ToString('R')
$body = @{
  query = "SELECT c.id, c.status, c.executionDurationMs, c.executedAt, c.persistenceWarning, c.leaderError FROM c WHERE c.id = 'swarm-2a7325bf-8e35-41bd-bba1-60010130d907'"
} | ConvertTo-Json
$headers = @{
  'Authorization' = $auth
  'x-ms-version' = '2018-12-31'
  'x-ms-date' = $date
  'x-ms-documentdb-isquery' = 'true'
  'x-ms-documentdb-query-enablecrosspartition' = 'true'
  'Content-Type' = 'application/query+json'
}
$r = Invoke-RestMethod -Method Post -Uri 'https://helkinswarm-cosmos-a7f2.documents.azure.com/dbs/helkinswarm/colls/sessions/docs' -Headers $headers -Body $body
$r.Documents | ConvertTo-Json -Depth 5
