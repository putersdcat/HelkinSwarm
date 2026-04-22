. C:\GitRoots\HelkinSwarm\scripts\agent-login.ps1 -Quiet -AzOnly
$st = 'helkinswarmsta7f2'
$tbl = (Get-AzAccessToken -ResourceUrl 'https://storage.azure.com/' -AsSecureString)
$tok = [System.Net.NetworkCredential]::new('', $tbl.Token).Password
$date = (Get-Date).ToUniversalTime().ToString('R')
$hdr = @{
  'Authorization' = "Bearer $tok"
  'x-ms-version' = '2020-12-06'
  'x-ms-date' = $date
  'Accept' = 'application/json;odata=nometadata'
}
$filter = "PartitionKey eq 'overseer-40f5c975-3aa2-47d8-b32d-a9d7a392f6dc-275026b74f89' or PartitionKey eq '@swarmchatroom@swarm-2a7325bf-8e35-41bd-bba1-60010130d907'"
$enc = [Uri]::EscapeDataString($filter)
$url = "https://$st.table.core.windows.net/HelkinSwarmHubInstances()?" + '$filter=' + $enc
$r = Invoke-WebRequest -Uri $url -Headers $hdr -UseBasicParsing
$j = $r.Content | ConvertFrom-Json
"=== Instances matching orphan PKs ==="
"count=$($j.value.Count)"
$j.value | ForEach-Object {
  $out = ''
  if ($_.Output) { $out = ' OUT=' + ($_.Output.Substring(0, [Math]::Min(120, $_.Output.Length)) -replace "`r|`n", ' ') }
  "PK=$($_.PartitionKey) name=$($_.Name) status=$($_.RuntimeStatus) created=$($_.CreatedTime) completed=$($_.CompletedTime)$out"
}
