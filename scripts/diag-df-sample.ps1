. C:\GitRoots\HelkinSwarm\scripts\agent-login.ps1 -Quiet -AzOnly
$st='helkinswarmsta7f2'
$tbl=(Get-AzAccessToken -ResourceUrl 'https://storage.azure.com/' -AsSecureString)
$tok=[System.Net.NetworkCredential]::new('',$tbl.Token).Password
function Q($table){
  $date=(Get-Date).ToUniversalTime().ToString('R')
  $hdr=@{'Authorization'="Bearer $tok";'x-ms-version'='2020-12-06';'x-ms-date'=$date;'Accept'='application/json;odata=nometadata'}
  $url="https://$st.table.core.windows.net/${table}()?`$top=20"
  (Invoke-WebRequest -Uri $url -Headers $hdr -UseBasicParsing).Content | ConvertFrom-Json | Select-Object -Expand value
}
foreach($t in 'helkinswarmfunca7f2Instances','HelkinSwarmHubInstances'){
  "=== $t (sample) ==="
  $rows = Q $t
  "rows=$($rows.Count)"
  if($rows.Count -gt 0){
    $r=$rows[0]
    $r.PSObject.Properties.Name | ForEach-Object { "  col=$_" }
    ""
    $rows | Select-Object -First 5 | ForEach-Object {
      "PK=$($_.PartitionKey) RK=$($_.RowKey) Name=$($_.Name) RuntimeStatus=$($_.RuntimeStatus) Created=$($_.CreatedTime)"
    }
  }
}
