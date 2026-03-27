# Patch the router bot's GraphOAuth connection with the actual clientSecret
# This fixes the root cause of /link outlook failing (#221)

$tenantId = "51b1f02a-e19b-4089-a5f6-3ebb72835521"
$clientId = "d4e5cf74-9f99-4504-b4ab-d4516dd10577"
$scopes = "User.Read Mail.ReadWrite Calendars.ReadWrite Files.ReadWrite offline_access"
$subId = "65b1d40b-8962-46cd-b2d7-fa5d09b787a1"
$rg = "rg-helkinswarm-router"
$botName = "helkinswarm-router-bot"
$connName = "GraphOAuth"

Write-Host "Reading secret from Key Vault..."
$secret = az keyvault secret show --vault-name "helkinswarm-kv-a7f2" --name "DelegatedAuthClientSecret" --query "value" -o tsv
if (-not $secret) {
    Write-Error "Failed to read secret from KV"
    exit 1
}
Write-Host "Secret read OK, length=$($secret.Length)"

$bodyObj = @{
    location = "global"
    properties = @{
        serviceProviderDisplayName = "Azure Active Directory v2"
        serviceProviderId = "30dd229c-58e3-4a48-bdfd-91ec48eb906c"
        clientId = $clientId
        clientSecret = $secret
        scopes = $scopes
        parameters = @(
            @{ key = "tenantID"; value = $tenantId }
            @{ key = "clientId"; value = $clientId }
            @{ key = "clientSecret"; value = $secret }
            @{ key = "scopes"; value = $scopes }
        )
    }
}

$bodyJson = $bodyObj | ConvertTo-Json -Depth 5
$tempFile = [System.IO.Path]::GetTempFileName()
$bodyJson | Out-File -FilePath $tempFile -Encoding utf8

Write-Host "Patching router GraphOAuth connection..."
$url = "/subscriptions/$subId/resourceGroups/$rg/providers/Microsoft.BotService/botServices/$botName/connections/$connName`?api-version=2022-09-15"
$result = az rest --method PUT --url $url --body "@$tempFile" --headers "Content-Type=application/json" 2>&1
Remove-Item $tempFile

Write-Host "Result:"
$result | Out-String | Write-Host

# Verify - list secrets to confirm
Write-Host ""
Write-Host "Verifying - checking secret status..."
$verify = az rest --method POST --url "/subscriptions/$subId/resourceGroups/$rg/providers/Microsoft.BotService/botServices/$botName/connections/$connName/listWithSecrets?api-version=2022-09-15" 2>&1 | ConvertFrom-Json
$secretVal = $verify.properties.clientSecret
$paramSecret = ($verify.properties.parameters | Where-Object { $_.key -eq "clientSecret" }).value
Write-Host "clientSecret (top-level): $(if ($secretVal) { 'SET (length=' + $secretVal.Length + ')' } else { 'NULL' })"
Write-Host "clientSecret (parameter): $(if ($paramSecret) { 'SET (length=' + $paramSecret.Length + ')' } else { 'NULL' })"
