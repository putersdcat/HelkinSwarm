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

# Window: anything created in the last 60 minutes (covers post-deploy window)
$nowUtc = (Get-Date).ToUniversalTime()
$fromUtc = $nowUtc.AddMinutes(-60)
$filter = "CreatedTime ge datetime'$($fromUtc.ToString('yyyy-MM-ddTHH:mm:ssZ'))'"

"=== HelkinSwarmHubInstances — last 60 min (now=$($nowUtc.ToString('o'))) ==="
$rows = QAll 'HelkinSwarmHubInstances' $filter
"rows=$($rows.Count)"
$rows |
  Where-Object { $_.Name -in @('swarmOrchestrator','sessionOrchestrator','overseer') -or $_.Name -like '*swarmchatroom*' } |
  Sort-Object CreatedTime |
  ForEach-Object {
    $tail = ''
    if($_.Output){ $tail = ' OUT=' + ($_.Output.Substring(0,[Math]::Min(180,$_.Output.Length)) -replace "`r|`n",' ') }
    "$($_.CreatedTime) name=$($_.Name) status=$($_.RuntimeStatus) completed=$($_.CompletedTime) PK=$($_.PartitionKey)$tail"
  }
