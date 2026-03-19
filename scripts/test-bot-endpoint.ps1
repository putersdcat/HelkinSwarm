$body = @{
    type = "message"
    id = "test-msg-001"
    timestamp = (Get-Date -Format o)
    channelId = "msteams"
    from = @{
        id = "29:test-user-id"
        name = "Test User"
        aadObjectId = "40f5c975-3aa2-47d8-b32d-a9d7a392f6dc"
    }
    conversation = @{
        id = "a:test-conversation-id"
        conversationType = "personal"
    }
    recipient = @{
        id = "28:e2883966-f38e-40e8-a1c0-d1145bdb23c5"
        name = "HelkinSwarm"
    }
    text = "Hello HelkinSwarm!"
    serviceUrl = "https://smba.trafficmanager.net/amer/"
} | ConvertTo-Json -Depth 4

$headers = @{ "Content-Type" = "application/json" }
$uri = "https://helkinswarm-func-a7f2.purplepebble-508e1162.eastus2.azurecontainerapps.io/api/messages"

try {
    $response = Invoke-WebRequest -Uri $uri -Method POST -Body $body -Headers $headers -UseBasicParsing
    Write-Output "Status: $($response.StatusCode)"
    Write-Output "Body: $($response.Content)"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.Value__
    Write-Output "Status: $statusCode"
    Write-Output "Body: $($_.ErrorDetails.Message)"
}
