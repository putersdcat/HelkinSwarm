. C:\GitRoots\HelkinSwarm\scripts\agent-login.ps1 -Quiet -AzOnly
$st='helkinswarmsta7f2'
# AAD storage data plane
$tbl=(Get-AzAccessToken -ResourceUrl 'https://storage.azure.com/' -AsSecureString)
$tok=[System.Net.NetworkCredential]::new('',$tbl.Token).Password
$date=(Get-Date).ToUniversalTime().ToString('R')
$hdr=@{'Authorization'="Bearer $tok";'x-ms-version'='2020-12-06';'x-ms-date'=$date;'Accept'='application/json;odata=nometadata'}
# List tables
$r=Invoke-WebRequest -Uri "https://$st.table.core.windows.net/Tables" -Headers $hdr -UseBasicParsing
($r.Content | ConvertFrom-Json).value | ForEach-Object { $_.TableName } | Where-Object { $_ -match 'Instances|History' }
