. C:\GitRoots\HelkinSwarm\scripts\agent-login.ps1 -Quiet -AzOnly
$st='helkinswarmsta7f2'
$tbl=(Get-AzAccessToken -ResourceUrl 'https://storage.azure.com/' -AsSecureString)
$tok=[System.Net.NetworkCredential]::new('',$tbl.Token).Password
function Q($table,$filter){
  $date=(Get-Date).ToUniversalTime().ToString('R')
  $hdr=@{'Authorization'="Bearer $tok";'x-ms-version'='2020-12-06';'x-ms-date'=$date;'Accept'='application/json;odata=nometadata'}
  $enc = [Uri]::EscapeDataString($filter)
  $url = "https://$st.table.core.windows.net/${table}()?" + '$filter=' + $enc
  (Invoke-WebRequest -Uri $url -Headers $hdr -UseBasicParsing).Content | ConvertFrom-Json | Select-Object -Expand value
}
# Find any instance whose Input contains corr 98afe7fb. Instances table: PartitionKey=instanceId, Input column.
# Filter on substring isn't supported in OData; pull recent instances by CreatedTime > 16:00
$today=(Get-Date).ToUniversalTime().Date.ToString('yyyy-MM-ddT00:00:00Z')
"=== Instances created today (helkinswarmfunca7f2Instances) ==="
$inst = Q 'helkinswarmfunca7f2Instances' "CreatedTime ge datetime'$today'"
"$($inst.Count) recent instances"
$inst | Where-Object { $_.Input -and $_.Input -match '98afe7fb' } | ForEach-Object {
  ""
  "PK=$($_.PartitionKey)"
  "  Name=$($_.Name) Status=$($_.RuntimeStatus) Created=$($_.CreatedTime) LastUpdated=$($_.LastUpdatedTime)"
  "  CompletedTime=$($_.CompletedTime)"
  if ($_.Output) { "  Output=$($_.Output.Substring(0,[Math]::Min(300,$_.Output.Length)))" }
  if ($_.CustomStatus) { "  Custom=$($_.CustomStatus.Substring(0,[Math]::Min(200,$_.CustomStatus.Length)))" }
}
"`n=== Sub-orchestrator + entity instances launched between 16:03 and 16:10 ==="
$inst | Where-Object {
  $created = [DateTime]::Parse($_.CreatedTime)
  $created -ge [DateTime]'2026-04-22T16:03:00Z' -and $created -le [DateTime]'2026-04-22T16:10:00Z'
} | Sort-Object CreatedTime | ForEach-Object {
  "$($_.CreatedTime) name=$($_.Name) status=$($_.RuntimeStatus) completed=$($_.CompletedTime) PK=$($_.PartitionKey)"
}
