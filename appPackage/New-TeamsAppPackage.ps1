#Requires -Version 7.0
<#
.SYNOPSIS
    Packages the HelkinSwarm Teams app manifest + icons into a sideloadable .zip.
    NOTE TO LLMs: THIS IS ONLY For Local Debug Use, not when deployed form GitHub Actions pipelines, see `.github\workflows\teams-package.yml` for production soluition

.DESCRIPTION
    Automatically increments the patch version in manifest.json (e.g. 1.1.0 → 1.1.1),
    validates the manifest and icon files, writes the new version back to manifest.json,
    then produces:  appPackage/HelkinSwarm-<version>.zip

    Drop that zip into Teams Admin Center → Apps → Manage apps → Upload new app,
    or sideload via Teams → Apps → Manage your apps → Upload a custom app.

.PARAMETER Open
    After packaging, open the appPackage folder in Explorer.

.PARAMETER SkipValidation
    Skip icon size/colour checks (useful if you don't have the dotnet imaging
    libraries available, but not recommended).

.PARAMETER Publish
    After building the zip, publish the package to the existing Teams app
    catalog entry via Microsoft Graph delegated auth:
      POST /appCatalogs/teamsApps/{teamsAppId}/appDefinitions

.PARAMETER TeamsAppId
    The Teams Admin Center app GUID (Graph teamsApp ID), not the botId.
    Default: e2883966-f38e-40e8-a1c0-d1145bdb23c5

.PARAMETER TenantId
    Entra tenant ID used for Connect-MgGraph delegated sign-in.

.PARAMETER RequiresReview
    Adds ?requiresReview=true to the publish endpoint.
    Default behavior (switch absent) is immediate publish when permitted.

.EXAMPLE
    .\scripts\New-TeamsAppPackage.ps1
    .\scripts\New-TeamsAppPackage.ps1 -Open
    .\scripts\New-TeamsAppPackage.ps1 -Publish
    .\scripts\New-TeamsAppPackage.ps1 -Publish -RequiresReview
#>
[CmdletBinding()]
param(
    [switch]$Open,
    [switch]$SkipValidation,
    [switch]$Publish,
    [string]$TeamsAppId = "13e1b315-79d3-4a0e-b234-1c1128883a05",
    [string]$TenantId = "51b1f02a-e19b-4089-a5f6-3ebb72835521",
    [switch]$RequiresReview
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Paths ────────────────────────────────────────────────────────────────────
$RepoRoot    = Split-Path $PSScriptRoot -Parent
$PackageDir  = Join-Path $RepoRoot "appPackage"
$ManifestPath = Join-Path $PackageDir "manifest.json"

# ── Load manifest ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "🤖 HelkinSwarm — Teams App Packager" -ForegroundColor Cyan
Write-Host "─────────────────────────────────────" -ForegroundColor DarkGray

if (-not (Test-Path $ManifestPath)) {
    Write-Error "manifest.json not found at: $ManifestPath"
    exit 1
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json

# ── Auto-increment patch version ─────────────────────────────────────────────
# Splits e.g. "1.1.0" → major=1, minor=1, patch=0 → bumps to "1.1.1"
# Teams rejects versions starting with 0 and requires #.#.# format.
$prevVersion = $manifest.version
$parts = $prevVersion -split '\.'
if ($parts.Count -ne 3) {
    Write-Error "manifest.json version '$prevVersion' is not in #.#.# format. Fix it and re-run."
    exit 1
}
$major = [int]$parts[0]
$minor = [int]$parts[1]
$patch = [int]$parts[2] + 1
$newVersion = "$major.$minor.$patch"
$manifest.version = $newVersion

# Write bumped version back to manifest.json (formatted, no BOM)
$manifestJson = $manifest | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($ManifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

$appVersion  = $newVersion
$colorIcon   = Join-Path $PackageDir $manifest.icons.color
$outlineIcon = Join-Path $PackageDir $manifest.icons.outline

Write-Host "  App ID   : $($manifest.id)"                         -ForegroundColor White
Write-Host "  Version  : $prevVersion → $appVersion (auto-bumped)" -ForegroundColor Yellow
Write-Host "  Bot ID   : $($manifest.bots[0].botId)" -ForegroundColor White
Write-Host "  Color    : $($manifest.icons.color)"   -ForegroundColor White
Write-Host "  Outline  : $($manifest.icons.outline)" -ForegroundColor White
Write-Host ""

# ── Validate required files ───────────────────────────────────────────────────
$errors = @()

if (-not (Test-Path $colorIcon)) {
    $errors += "Color icon not found: $($manifest.icons.color)"
}
if (-not (Test-Path $outlineIcon)) {
    $errors += "Outline icon not found: $($manifest.icons.outline)"
}

# Teams icon size requirements
if (-not $SkipValidation) {
    # Teams requires: color = 192×192, outline = 32×32 (transparent white)
    # Check file size as a proxy (stub placeholder files are near-empty)
    $colorSize   = (Get-Item $colorIcon   -ErrorAction SilentlyContinue)?.Length ?? 0
    $outlineSize = (Get-Item $outlineIcon -ErrorAction SilentlyContinue)?.Length ?? 0

    if ($colorSize -lt 1000) {
        $errors += "Color icon looks like a placeholder (only ${colorSize} bytes). Teams requires a 192×192 PNG."
    }
    if ($outlineSize -lt 200) {
        $errors += "Outline icon looks like a placeholder (only ${outlineSize} bytes). Teams requires a 32×32 PNG."
    }
}

# Validate botId matches id (Teams requirement)
if ($manifest.bots[0].botId -ne $manifest.id) {
    $errors += "botId ($($manifest.bots[0].botId)) must match manifest id ($($manifest.id))"
}

# Validate validDomains is not empty
if ($manifest.validDomains.Count -eq 0) {
    $errors += "validDomains is empty — Teams will reject this. Add your bot's hostname."
}

if ($errors.Count -gt 0) {
    Write-Host "❌  Validation failed:" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "    • $_" -ForegroundColor Red }
    Write-Host ""
    exit 1
}

Write-Host "✅  Validation passed" -ForegroundColor Green

# ── Build zip ─────────────────────────────────────────────────────────────────
$ZipName = "HelkinSwarm-$appVersion.zip"
$ZipPath = Join-Path $PackageDir $ZipName

# Remove any existing package with this version
if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
    Write-Host "  Removed old: $ZipName" -ForegroundColor DarkGray
}

# Teams app packages must contain ONLY these three files at the root of the zip
# (no subdirectory nesting — Teams rejects nested structures)
$filesToPackage = @(
    $ManifestPath,
    $colorIcon,
    $outlineIcon
)

# Compress-Archive puts files at the root only if you pass them as array
Compress-Archive -Path $filesToPackage -DestinationPath $ZipPath -CompressionLevel Optimal

$zipSize = [math]::Round((Get-Item $ZipPath).Length / 1KB, 1)

Write-Host ""
Write-Host "📦  Package built: $ZipName ($zipSize KB)" -ForegroundColor Green
Write-Host "    Path: $ZipPath" -ForegroundColor DarkGray
Write-Host ""

# ── Verify zip contents ───────────────────────────────────────────────────────
Write-Host "  Contents:" -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
$zip.Entries | Sort-Object Name | ForEach-Object {
    $entryKB = [math]::Round($_.Length / 1KB, 1)
    Write-Host "    ✓ $($_.Name) ($entryKB KB)" -ForegroundColor White
}
$zip.Dispose()
Write-Host ""

# ── Sideload instructions ─────────────────────────────────────────────────────
Write-Host "🚀  How to sideload in Teams:" -ForegroundColor Yellow
Write-Host "    1. Open Microsoft Teams" -ForegroundColor White
Write-Host "    2. Left sidebar → Apps" -ForegroundColor White
Write-Host "    3. Bottom-left → Manage your apps" -ForegroundColor White
Write-Host "    4. Top-right → Upload an app → Upload a custom app" -ForegroundColor White
Write-Host "    5. Select: $ZipPath" -ForegroundColor Cyan
Write-Host "    6. Click Add → chat with HelkinSwarm" -ForegroundColor White
Write-Host ""
Write-Host "    ℹ  If 'Upload a custom app' is missing, enable sideloading in Teams Admin Center:" -ForegroundColor DarkGray
Write-Host "       https://admin.teams.microsoft.com → Teams apps → Setup policies → Global → Upload custom apps" -ForegroundColor DarkGray
Write-Host ""

# ── Open folder ──────────────────────────────────────────────────────────────
if ($Open) {
    Start-Process explorer.exe $PackageDir
}

# ── Optional: Publish to Teams app catalog via Graph ─────────────────────────
if ($Publish) {
    Write-Host "📤  Publishing package to Teams app catalog..." -ForegroundColor Yellow
    Write-Host "    Teams App ID : $TeamsAppId" -ForegroundColor White

    # Ensure Graph module is available
    if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
        throw "Microsoft Graph PowerShell SDK not found. Install-Module Microsoft.Graph -Scope CurrentUser"
    }

    $requiredScopes = @(
        "AppCatalog.Submit",
        "AppCatalog.ReadWrite.All"
    )

    $ctx = Get-MgContext -ErrorAction SilentlyContinue
    $isConnected = $null -ne $ctx
    $missingScopes = @()

    if ($isConnected) {
        foreach ($scope in $requiredScopes) {
            if (-not ($ctx.Scopes -contains $scope)) {
                $missingScopes += $scope
            }
        }
    }

    if (-not $isConnected -or $missingScopes.Count -gt 0 -or $ctx.TenantId -ne $TenantId) {
        Write-Host "    Connecting to Microsoft Graph (delegated)..." -ForegroundColor DarkGray
        Connect-MgGraph -TenantId $TenantId -Scopes $requiredScopes -NoWelcome | Out-Null
    }

    $publishUri = "https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/$TeamsAppId/appDefinitions"
    if ($RequiresReview) {
        $publishUri += "?requiresReview=true"
    }

    $zipBytes = [System.IO.File]::ReadAllBytes($ZipPath)

    try {
        # Graph returns 204 No Content for successful publish in immediate mode.
        Invoke-MgGraphRequest -Method POST -Uri $publishUri -Body $zipBytes -ContentType "application/zip" -ErrorAction Stop | Out-Null

        Write-Host "✅  Published to Teams app catalog" -ForegroundColor Green
        if ($RequiresReview) {
            Write-Host "    Submission requires admin review (requiresReview=true)." -ForegroundColor Yellow
        }
        Write-Host "    Verify: https://admin.teams.microsoft.com/policies/manage-apps/$TeamsAppId/" -ForegroundColor Cyan
    }
    catch {
        Write-Host "❌  Publish failed" -ForegroundColor Red
        Write-Host "    $_" -ForegroundColor Red
        throw
    }
}
