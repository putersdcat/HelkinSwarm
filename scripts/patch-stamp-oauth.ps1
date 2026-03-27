# Patch the stamp bot's GraphOAuth connection too
$tenantId = "51b1f02a-e19b-4089-a5f6-3ebb72835521"
$clientId = "d4e5cf74-9f99-4504-b4ab-d4516dd10577"
$scopes = "User.Read Mail.ReadWrite Calendars.ReadWrite Files.ReadWrite offline_access"
$subId = "65b1d40b-8962-46cd-b2d7-fa5d09b787a1"
$rg = "rg-helkinswarm-a7f2"
$botName = "helkinswarm-bot-a7f2"
$connName = "GraphOAuth"

$secret = az keyvault secret show --vault-name "helkinswarm-kv-a7f2" --name "DelegatedAuthClientSecret" --query "value" -o tsv
Write-Host "Secret length=$($secret.Length)"

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

$url = "/subscriptions/$subId/resourceGroups/$rg/providers/Microsoft.BotService/botServices/$botName/connections/$connName`?api-version=2022-09-15"
$result = az rest --method PUT --url $url --body "@$tempFile" --headers "Content-Type=application/json" 2>&1
Remove-Item $tempFile

$parsed = $result | ConvertFrom-Json
Write-Host "Stamp provisioningState: $($parsed.properties.provisioningState)"
Write-Host "Stamp clientId: $($parsed.properties.clientId)"
Write-Host "Stamp clientSecret SET: $(if ($parsed.properties.clientSecret) { 'yes (length=' + $parsed.properties.clientSecret.Length + ')' } else { 'NO' })"
