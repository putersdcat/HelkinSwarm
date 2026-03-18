#Requires -Version 7.0
<#
.SYNOPSIS
    Exports Microsoft Teams chat history to nicely-formatted Markdown files.

.DESCRIPTION
    Uses the Microsoft Graph API (Chat.Read delegated permission) with device-code
    OAuth via the pre-registered "HelkinSwarm Graph Client" app.

    First run: opens a browser auth page (code copied to clipboard).
    Subsequent runs: uses a DPAPI-encrypted cached refresh token.

    Output files land under docs\ChatLogs\ by default.

.PARAMETER ChatFilter
    Optional substring to auto-select matching chats (e.g. "HelkinSwarm").
    If omitted you'll get an interactive pick-list.

.PARAMETER OutputDir
    Where to write Markdown files. Defaults to docs\Archive\ChatLogs relative
    to the workspace root (resolved from $PSScriptRoot\..).

.PARAMETER MaxMessages
    Hard cap on messages retrieved per chat. Default 10 000.

.PARAMETER ForceAuth
    Ignore any cached token and force a fresh device-code login.

.PARAMETER AllChats
    Skip the pick-list and export every chat found.

.EXAMPLE
    # Interactive pick-list
    .\scripts\Export-TeamsChatHistory.ps1

.EXAMPLE
    # Export only chats whose name contains "HelkinSwarm"
    .\scripts\Export-TeamsChatHistory.ps1 -ChatFilter "HelkinSwarm"

.EXAMPLE
    # Export everything, override output path
    .\scripts\Export-TeamsChatHistory.ps1 -AllChats -OutputDir "C:\Exports"

.NOTES
    Required Graph delegated permissions on the registered app:
      Chat.Read, User.Read, offline_access
    Token cache: $env:LOCALAPPDATA\HelkinSwarm\graph_token.bin (DPAPI-encrypted)
#>

[CmdletBinding()]
param(
    [string] $ChatFilter  = "",
    [string] $OutputDir   = (Join-Path $PSScriptRoot "..\docs\ChatLogs"),
    [int]    $MaxMessages = 10000,
    [switch] $ForceAuth,
    [switch] $AllChats
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Constants — matches azureInfo.md + app registration
# ---------------------------------------------------------------------------
$TenantId   = "51b1f02a-e19b-4089-a5f6-3ebb72835521"
$ClientId   = "65c0820d-5ebd-4f04-ae19-d2deda19af70"
$GraphScope = "https://graph.microsoft.com/Chat.Read " +
              "https://graph.microsoft.com/User.Read " +
              "offline_access"
$GraphBase  = "https://graph.microsoft.com/v1.0"
$TokenDir   = Join-Path $env:LOCALAPPDATA "HelkinSwarm"
$TokenFile  = Join-Path $TokenDir "graph_token.bin"   # DPAPI-encrypted JSON

# ---------------------------------------------------------------------------
#region Token cache — DPAPI (machine+user bound, Windows only)
# ---------------------------------------------------------------------------
Add-Type -AssemblyName System.Security

function Protect-String {
    param([string]$Plaintext)
    $bytes     = [System.Text.Encoding]::UTF8.GetBytes($Plaintext)
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
        $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Convert]::ToBase64String($encrypted)
}

function Unprotect-String {
    param([string]$Base64)
    $encrypted = [Convert]::FromBase64String($Base64)
    $bytes     = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Save-TokenCache {
    param($AccessToken, $RefreshToken, [datetime]$ExpiresAt)
    if (-not (Test-Path $TokenDir)) { New-Item -ItemType Directory $TokenDir -Force | Out-Null }
    $payload = @{
        AccessToken  = $AccessToken
        RefreshToken = $RefreshToken
        ExpiresAt    = $ExpiresAt.ToString("o")
    } | ConvertTo-Json
    Protect-String $payload | Set-Content -Path $TokenFile -Encoding ASCII
    Write-Verbose "Token cache written → $TokenFile"
}

function Read-TokenCache {
    if (-not (Test-Path $TokenFile)) { return $null }
    try {
        $json  = Unprotect-String (Get-Content $TokenFile -Raw -Encoding ASCII)
        $cache = $json | ConvertFrom-Json
        return $cache
    } catch {
        Write-Warning "Token cache unreadable (may be from a different user/machine): $_"
        return $null
    }
}
#endregion

# ---------------------------------------------------------------------------
#region OAuth — device-code flow
# ---------------------------------------------------------------------------
function Invoke-TokenRefresh {
    param([string]$RefreshToken)
    try {
        $r = Invoke-RestMethod -Method POST `
            -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" `
            -ContentType "application/x-www-form-urlencoded" `
            -Body @{
                grant_type    = "refresh_token"
                client_id     = $ClientId
                refresh_token = $RefreshToken
                scope         = $GraphScope
            }
        return $r
    } catch {
        Write-Warning "Token refresh failed: $_"
        return $null
    }
}

function Get-AccessToken {
    param([switch]$Force)

    # --- try cache first ---
    if (-not $Force) {
        $cache = Read-TokenCache
        if ($cache) {
            $expiry = [datetime]$cache.ExpiresAt
            if ($expiry -gt (Get-Date).AddMinutes(5)) {
                Write-Host "✅ Cached token valid until $($expiry.ToString('HH:mm:ss'))" -ForegroundColor Green
                return $cache.AccessToken
            }
            Write-Host "⏳ Access token expired — refreshing..." -ForegroundColor Yellow
            $r = Invoke-TokenRefresh -RefreshToken $cache.RefreshToken
            if ($r) {
                Save-TokenCache -AccessToken $r.access_token `
                    -RefreshToken ($r.refresh_token ?? $cache.RefreshToken) `
                    -ExpiresAt (Get-Date).AddSeconds($r.expires_in)
                return $r.access_token
            }
        }
    }

    # --- device-code flow ---
    Write-Host ""
    Write-Host "🔐  Initiating device-code authentication..." -ForegroundColor Cyan

    $dc = Invoke-RestMethod -Method POST `
        -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode" `
        -ContentType "application/x-www-form-urlencoded" `
        -Body @{ client_id = $ClientId; scope = $GraphScope }

    $dc.user_code | Set-Clipboard
    Write-Host ""
    Write-Host "  ┌──────────────────────────────────────────────────┐" -ForegroundColor Yellow
    Write-Host "  │  Open:  $($dc.verification_uri)" -ForegroundColor White
    Write-Host "  │  Code:  $($dc.user_code)  (copied to clipboard)" -ForegroundColor Cyan
    Write-Host "  └──────────────────────────────────────────────────┘" -ForegroundColor Yellow
    Write-Host ""

    $deadline = (Get-Date).AddSeconds($dc.expires_in)
    $interval = [int]($dc.interval ?? 5)

    Write-Host "  Waiting for authentication" -NoNewline -ForegroundColor DarkGray
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds $interval
        Write-Host "." -NoNewline -ForegroundColor DarkGray
        try {
            $r = Invoke-RestMethod -Method POST `
                -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" `
                -ContentType "application/x-www-form-urlencoded" `
                -Body @{
                    grant_type  = "urn:ietf:params:oauth:grant-type:device_code"
                    client_id   = $ClientId
                    device_code = $dc.device_code
                } -ErrorAction Stop
            Write-Host ""
            Write-Host "  ✅ Authenticated!" -ForegroundColor Green
            Save-TokenCache -AccessToken $r.access_token `
                -RefreshToken $r.refresh_token `
                -ExpiresAt (Get-Date).AddSeconds($r.expires_in)
            return $r.access_token
        } catch {
            $err = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($err.error -eq "authorization_pending") { continue }
            if ($err.error -eq "slow_down")             { $interval += 5; continue }
            if ($err.error -eq "expired_token")         { break }
            throw
        }
    }
    throw "Device-code authentication timed out."
}
#endregion

# ---------------------------------------------------------------------------
#region Graph helpers
# ---------------------------------------------------------------------------
function Invoke-Graph {
    param([string]$Url, [string]$Token)
    $headers = @{ Authorization = "Bearer $Token" }
    if (-not $Url.StartsWith("http")) { $Url = "$GraphBase/$Url" }
    Invoke-RestMethod -Method GET -Uri $Url -Headers $headers
}

function Get-AllPages {
    param([string]$Url, [string]$Token, [int]$Max = [int]::MaxValue)
    $list = [System.Collections.Generic.List[object]]::new()
    $next = $Url
    while ($next -and $list.Count -lt $Max) {
        $page = Invoke-Graph -Url $next -Token $Token
        # StrictMode-safe property access — @odata.nextLink and value may not exist
        if ($page.PSObject.Properties['value'] -and $page.value) {
            $list.AddRange([object[]]$page.value)
        }
        $next = if ($page.PSObject.Properties['@odata.nextLink']) {
            $page.'@odata.nextLink'
        } else { $null }
        Write-Host "." -NoNewline -ForegroundColor DarkGray
    }
    return [object[]]$list
}
#endregion

# ---------------------------------------------------------------------------
#region Chat helpers
# ---------------------------------------------------------------------------
function Get-ChatDisplayName {
    param($Chat, [string]$MyId)
    # StrictMode-safe: use PSObject.Properties to guard optional fields
    $topic = if ($Chat.PSObject.Properties['topic'] -and $Chat.topic) { $Chat.topic } else { $null }
    if ($topic) { return $topic }

    # 1:1 → use the other participant's display name
    $chatType = if ($Chat.PSObject.Properties['chatType']) { $Chat.chatType } else { '' }
    $members  = if ($Chat.PSObject.Properties['members']  -and $Chat.members) { $Chat.members } else { $null }
    if ($chatType -eq 'oneOnOne' -and $members) {
        # Graph members have 'userId' or 'id'; filter out self
        $other = @($members | Where-Object {
            $uid = if ($_.PSObject.Properties['userId']) { $_.userId }
                   elseif ($_.PSObject.Properties['id'])   { $_.id }
                   else { '' }
            $uid -ne $MyId
        })
        if ($other.Count -gt 0) {
            $dn = if ($other[0].PSObject.Properties['displayName']) { $other[0].displayName } else { '' }
            if ($dn) { return $dn }
        }
    }
    # Fallback: truncated chat ID (safe even if id is short)
    $rawId = if ($Chat.PSObject.Properties['id'] -and $Chat.id) { $Chat.id } else { 'unknown' }
    $suffix = if ($rawId.Length -ge 12) { $rawId.Substring([Math]::Min(3, $rawId.Length - 1), [Math]::Min(12, $rawId.Length - [Math]::Min(3, $rawId.Length - 1))) } else { $rawId }
    return "Chat_$suffix"
}

function ConvertFrom-HtmlToMarkdown {
    param([string]$Html)
    if (-not $Html) { return "" }
    $md = $Html
    # Block elements → newlines
    $md = $md -replace '(?i)<br\s*/?>'            , "`n"
    $md = $md -replace '(?i)</?p[^>]*>'           , "`n"
    $md = $md -replace '(?i)</?div[^>]*>'         , "`n"
    $md = $md -replace '(?i)</?li[^>]*>'          , "`n- "
    $md = $md -replace '(?i)</?ul[^>]*>'          , ""
    $md = $md -replace '(?i)</?ol[^>]*>'          , ""
    # Inline formatting
    $md = $md -replace '(?i)<strong[^>]*>'        , "**"
    $md = $md -replace '(?i)</strong>'            , "**"
    $md = $md -replace '(?i)<b[^>]*>'             , "**"
    $md = $md -replace '(?i)</b>'                 , "**"
    $md = $md -replace '(?i)<em[^>]*>'            , "_"
    $md = $md -replace '(?i)</em>'                , "_"
    $md = $md -replace '(?i)<i[^>]*>'             , "_"
    $md = $md -replace '(?i)</i>'                 , "_"
    $md = $md -replace '(?i)<code[^>]*>'          , '`'
    $md = $md -replace '(?i)</code>'              , '`'
    $md = $md -replace '(?i)<pre[^>]*>'           , "``````"
    $md = $md -replace '(?i)</pre>'               , "``````"
    # Strip remaining tags
    $md = $md -replace '<[^>]+>'                  , ""
    # Decode HTML entities
    $md = [System.Net.WebUtility]::HtmlDecode($md)
    # Collapse excessive blank lines (keep max 1)
    $md = $md -replace '(\r?\n){3,}'             , "`n`n"
    return $md.Trim()
}

function Export-ChatToMarkdown {
    param($Chat, [string]$Token, [string]$OutDir, [int]$Max, [string]$MyId)

    $name = Get-ChatDisplayName -Chat $Chat -MyId $MyId

    Write-Host ""
    Write-Host "  📨 Exporting: " -NoNewline -ForegroundColor Cyan
    Write-Host $name -ForegroundColor White
    Write-Host "     Type   : $($Chat.chatType)" -ForegroundColor DarkGray
    Write-Host "     Chat ID: $($Chat.id)" -ForegroundColor DarkGray
    Write-Host "     Fetching messages" -NoNewline -ForegroundColor DarkGray

    # Graph returns messages newest-first; collect all pages then sort chronologically
    $msgs = Get-AllPages `
        -Url "me/chats/$($Chat.id)/messages?`$top=50" `
        -Token $Token `
        -Max $Max

    $msgs = @($msgs | Sort-Object { [datetime]$_.createdDateTime })

    Write-Host " → $($msgs.Count) messages" -ForegroundColor DarkGray

    # If the name is still a raw fallback, try to derive a better name from
    # the first application-type sender found in the messages themselves.
    if ($name -like "Chat_*") {
        $botMsg = $msgs | Where-Object {
            $_.PSObject.Properties['from'] -and $_.from -and
            $_.from.PSObject.Properties['application'] -and $_.from.application -and
            $_.from.application.PSObject.Properties['displayName'] -and
            $_.from.application.displayName
        } | Select-Object -First 1
        if ($botMsg) {
            $botName = $botMsg.from.application.displayName
            $name = "DM_${botName}"
            Write-Host "     Name resolved from messages → $name" -ForegroundColor DarkGray
        }
    }

    $safeName = ($name -replace '[\\/:*?"<>|]', '_').Trim('_').Trim()
    $stamp    = Get-Date -Format "yyyy-MM-dd_HHmmss"
    $outFile  = Join-Path $OutDir "${safeName}_${stamp}.md"

    # ── Build Markdown ────────────────────────────────────────────────────
    $sb = [System.Text.StringBuilder]::new(64KB)

    [void]$sb.AppendLine("# Teams Chat Export — $name")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("| Field | Value |")
    [void]$sb.AppendLine("|-------|-------|")
    [void]$sb.AppendLine("| **Exported**    | $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') local |")
    [void]$sb.AppendLine("| **Chat name**   | $name |")
    [void]$sb.AppendLine("| **Chat type**   | $($Chat.chatType) |")
    [void]$sb.AppendLine("| **Chat ID**     | ``$($Chat.id)`` |")
    [void]$sb.AppendLine("| **Messages**    | $($msgs.Count) |")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("---")
    [void]$sb.AppendLine("")

    $curDate = ""
    foreach ($msg in $msgs) {
        # Only real messages (skip system events, etc.)
        if ($msg.messageType -ne "message") { continue }

        $ts      = ([datetime]$msg.createdDateTime).ToLocalTime()
        $dateStr = $ts.ToString("yyyy-MM-dd")
        $timeStr = $ts.ToString("HH:mm")

        # Date heading
        if ($dateStr -ne $curDate) {
            $curDate = $dateStr
            [void]$sb.AppendLine("## 📅 $dateStr")
            [void]$sb.AppendLine("")
        }

        # Sender (StrictMode-safe: null-guard $msg.from before property access)
        $fromUser = if ($msg.PSObject.Properties['from'] -and $msg.from) {
            $msg.from
        } else { $null }
        $msgSender = if ($fromUser -and $fromUser.PSObject.Properties['user']   -and $fromUser.user)        { $fromUser.user.displayName }
                     elseif ($fromUser -and $fromUser.PSObject.Properties['application'] -and $fromUser.application) { $fromUser.application.displayName }
                     else { "System" }
        $isBot     = $fromUser -and $fromUser.PSObject.Properties['application'] -and $null -ne $fromUser.application
        $botBadge  = if ($isBot) { " 🤖" } else { "" }

        [void]$sb.AppendLine("**${msgSender}${botBadge}** · $timeStr")
        [void]$sb.AppendLine("")

        # Body content
        $body = switch ($msg.body.contentType) {
            "html" { ConvertFrom-HtmlToMarkdown -Html $msg.body.content }
            default { $msg.body.content?.Trim() }
        }
        if ($body) {
            [void]$sb.AppendLine($body)
        } else {
            [void]$sb.AppendLine("_[no text content]_")
        }
        [void]$sb.AppendLine("")

        # Attachments (cards, file references)
        if ($msg.attachments -and $msg.attachments.Count -gt 0) {
            foreach ($att in $msg.attachments) {
                switch ($att.contentType) {
                    "reference" {
                        [void]$sb.AppendLine("📎 [$($att.name)]($($att.contentUrl))")
                    }
                    "application/vnd.microsoft.card.adaptive" {
                        [void]$sb.AppendLine("🃏([string]$att.name)ve Card — content omitted]_")
                    }
                    default {
                        if ($att.name -and -not $att.name.StartsWith("{")) {
                            [void]$sb.AppendLine("📎 $($att.name)")
                        }
                    }
                }
            }
            [void]$sb.AppendLine("")
        }

        [void]$sb.AppendLine("---")
        [void]$sb.AppendLine("")
    }

    $sb.ToString() | Set-Content -Path $outFile -Encoding UTF8 -Force
    return $outFile
}
#endregion

# ---------------------------------------------------------------------------
#region Main
# ---------------------------------------------------------------------------
# Resolve and ensure output dir
$OutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Host "📁 Created output dir: $OutputDir" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "══════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  Export-TeamsChatHistory  ·  HelkinSwarm" -ForegroundColor Magenta
Write-Host "══════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host ""

# Authenticate
$token = Get-AccessToken -Force:$ForceAuth

# Who am I?
Write-Host ""
Write-Host "👤 Resolving identity..." -NoNewline -ForegroundColor Cyan
$me = Invoke-Graph -Url "me" -Token $token
Write-Host " $($me.displayName) ($($me.userPrincipalName))" -ForegroundColor Green

# Fetch chats (expand members for display name resolution in 1:1 chats)
Write-Host ""
Write-Host "💬 Fetching chat list" -NoNewline -ForegroundColor Cyan
$chats = Get-AllPages -Url "me/chats?`$expand=members&`$top=50" -Token $token
Write-Host " — $($chats.Count) chat(s) found" -ForegroundColor Cyan

# Annotate with computed display name
foreach ($c in $chats) {
    $c | Add-Member -NotePropertyName "_name" `
        -NotePropertyValue (Get-ChatDisplayName -Chat $c -MyId $me.id) -Force
}

# Determine which chats to export
$toExport = if ($ChatFilter) {
    $matched = @($chats | Where-Object { $_._name -like "*$ChatFilter*" })
    if ($matched.Count -eq 0) {
        Write-Warning "No chats matched filter '$ChatFilter'. Available chats:"
        $chats | ForEach-Object {
            $displayName = if ($_._name) { $_._name } else { '(unnamed)' }
            $type        = if ($_.PSObject.Properties['chatType']) { $_.chatType } else { '?' }
            Write-Host "  · [$type]  $displayName" -ForegroundColor White
        }
        exit 1
    }
    Write-Host "🎯 Filter '$ChatFilter' matched $($matched.Count) chat(s)" -ForegroundColor Green
    $matched
} elseif ($AllChats) {
    Write-Host "📋 Exporting ALL $($chats.Count) chats" -ForegroundColor Yellow
    $chats
} else {
    # Interactive pick-list
    Write-Host ""
    Write-Host "📋 Available chats:" -ForegroundColor Yellow
    Write-Host ""
    for ($i = 0; $i -lt $chats.Count; $i++) {
        $c = $chats[$i]
        Write-Host ("  [{0,2}]  {1,-45}  [{2}]" -f $i, $c._name, $c.chatType) -ForegroundColor White
    }
    Write-Host ""
    $raw = Read-Host "Enter index(es) to export (comma-separated) or 'a' for all"
    if ($raw.Trim() -eq 'a') {
        $chats
    } else {
        $indices = $raw -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' }
        @($indices | ForEach-Object { $chats[[int]$_] } | Where-Object { $_ })
    }
}

# Export
$exported = [System.Collections.Generic.List[string]]::new()
foreach ($chat in $toExport) {
    try {
        $file = Export-ChatToMarkdown `
            -Chat $chat -Token $token -OutDir $OutputDir `
            -Max $MaxMessages -MyId $me.id
        $exported.Add($file)
        Write-Host "  ✅ $file" -ForegroundColor Green
    } catch {
        Write-Warning "Failed to export '$($chat._name)': $_"
    }
}

Write-Host ""
Write-Host "══════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  ✅ Done — $($exported.Count) file(s) written" -ForegroundColor Green
Write-Host "══════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host ""
$exported | ForEach-Object { Write-Host "  $_" -ForegroundColor Cyan }
Write-Host ""
#endregion
