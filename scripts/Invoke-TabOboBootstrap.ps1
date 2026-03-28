param(
  [Parameter(Mandatory = $true)]
  [string]$UserAlias,

  [Parameter(Mandatory = $true)]
  [string]$BearerToken
)

$ErrorActionPreference = 'Stop'

$functionAppName = "helkinswarm-func-$UserAlias"
$resourceGroupName = "rg-helkinswarm-$UserAlias"

$hostName = az webapp show `
  --name $functionAppName `
  --resource-group $resourceGroupName `
  --query defaultHostName -o tsv

if (-not $hostName) {
  throw "Could not resolve defaultHostName for $functionAppName"
}

$uri = "https://$hostName/api/tab/bootstrap-obo"

$response = Invoke-RestMethod `
  -Method Post `
  -Uri $uri `
  -Headers @{ Authorization = "Bearer $BearerToken" }

$response | ConvertTo-Json -Depth 5