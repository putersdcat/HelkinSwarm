. C:\GitRoots\HelkinSwarm\scripts\agent-login.ps1 -Quiet -AzOnly
$rg='rg-helkinswarm-a7f2'
$accts = az storage account list -g $rg --query "[].name" -o tsv
Write-Host "accounts:"
$accts -split "`n" | ForEach-Object { "  $_" }
$st = ($accts -split "`n" | Where-Object { $_ -match 'helkin' } | Select-Object -First 1).Trim()
Write-Host "selected=$st"
$key = az storage account keys list -g $rg -n $st --query "[0].value" -o tsv
$tables = az storage table list --account-name $st --account-key $key --query "[].name" -o tsv
Write-Host "tables:"
$tables -split "`n" | ForEach-Object { "  $_" }
