. C:\GitRoots\HelkinSwarm\scripts\agent-login.ps1 -Quiet -AzOnly
$st='helkinswarmsta7f2'
$tbl=(Get-AzAccessToken -ResourceUrl 'https://storage.azure.com/' -AsSecureString)
$tok=[System.Net.NetworkCredential]::new('',$tbl.Token).Password
function QAll($table,$filter){
  $date=(Get-Date).ToUniversalTime().ToString('R')
  $hdr=@{'Authorization'="Bearer $tok";'x-ms-version'='2020-12-06';'x-ms-date'=$date;'Accept'='application/json;odata=nometadata'}
  $enc=[Uri]::EscapeDataString($filter)
  $url="https://$st.table.core.windows.net/${table}()?" + '$filter=' + $enc + '&$top=1000'
  $all=@()
  do{
    $r=Invoke-WebRequest -Uri $url -Headers $hdr -UseBasicParsing
    $j=$r.Content|ConvertFrom-Json
    $all+=$j.value
    $npk=$r.Headers['x-ms-continuation-NextPartitionKey']
    $nrk=$r.Headers['x-ms-continuation-NextRowKey']
    if($npk){
      $url="https://$st.table.core.windows.net/${table}()?" + '$filter=' + $enc + '&$top=1000&NextPartitionKey=' + $npk[0] + '&NextRowKey=' + $nrk[0]
    } else { $url=$null }
  } while($url)
  $all
}
foreach($t in 'helkinswarmfunca7f2Instances','HelkinSwarmHubInstances'){
  "=== $t — instances created 2026-04-22T15:50..16:30 ==="
  $rows = QAll $t "CreatedTime ge datetime'2026-04-22T15:50:00Z' and CreatedTime le datetime'2026-04-22T16:30:00Z'"
  "rows=$($rows.Count)"
  $rows | Sort-Object CreatedTime | ForEach-Object {
    $tail = ''
    if($_.Output){ $tail = ' OUT=' + $_.Output.Substring(0,[Math]::Min(120,$_.Output.Length)) -replace "`r|`n",' ' }
    if($_.Input -and $_.Input -match '98afe7fb|2a7325bf'){ $tail += ' [MATCH-CORR]' }
    "$($_.CreatedTime) name=$($_.Name) status=$($_.RuntimeStatus) completed=$($_.CompletedTime) PK=$($_.PartitionKey)$tail"
  }
}
