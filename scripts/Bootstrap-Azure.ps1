<#
.SYNOPSIS
    One-time Azure bootstrap for HelkinSwarm infrastructure.
    Creates OIDC app + federated credentials, resource group, GitHub variables,
    and runs the initial Bicep deployment.

.DESCRIPTION
    Run this ONCE from a developer machine with:
      - Azure CLI authenticated (az login) with Owner/Contributor on target subscription
      - GitHub CLI authenticated (gh auth login)

    EVERY step validates its exit code and halts on failure. No silent swallowing.
    Re-running is safe — all steps are idempotent (check-before-create).

    After this script completes, every push to main goes through the CD pipeline.

.EXAMPLE
    .\scripts\Bootstrap-Azure.ps1

.NOTES
    Refs: #5 (EPIC Bootstrap), #7 (Bicep), #9 (CD pipeline)
    @see docs/03-Tech-Stack-Infrastructure.md
    @see docs/12-Deployment-CICD.md
#>

[CmdletBinding()]
param(
    [string]$ResourceGroup   = 'helkinswarm-prod-eus2',
    [string]$Location        = 'eastus2',
    [string]$SubscriptionId  = '65b1d40b-8962-46cd-b2d7-fa5d09b787a1',
    [string]$TenantId        = '51b1f02a-e19b-4089-a5f6-3ebb72835521',
    [string]$GitHubRepo      = 'putersdcat/HelkinSwarm',
    [string]$UserUpn         = 'eric@putersdcat.com'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ─── Hard-fail helper ───────────────────────────────────────────────────────
# az CLI errors set $LASTEXITCODE but do NOT throw PowerShell exceptions.
# This function must be called after every az/gh command that must succeed.
function Assert-ExitCode {
    param(
        [string]$StepName,
        [int]$ExitCode = $LASTEXITCODE
    )
    if ($ExitCode -ne 0) {
        Write-Host "  ❌ FAILED: $StepName (exit code $ExitCode)" -ForegroundColor Red
        throw "Bootstrap halted at: $StepName"
    }
}

Write-Host "`n════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  HelkinSwarm 🤖 — One-Time Azure Bootstrap" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

# ─── 0. Verify prerequisites ────────────────────────────────────────────────

Write-Host "📋 Verifying prerequisites..." -ForegroundColor Yellow

$azAccount = az account show --query '{sub:id, tenant:tenantId, user:user.name}' -o json 2>$null | ConvertFrom-Json
if (-not $azAccount) {
    throw "Azure CLI not authenticated. Run: az login"
}
if ($azAccount.sub -ne $SubscriptionId) {
    Write-Host "  ⚠️  Active subscription is $($azAccount.sub), expected $SubscriptionId" -ForegroundColor Yellow
    Write-Host "  Switching subscription..." -ForegroundColor Yellow
    az account set --subscription $SubscriptionId
    Assert-ExitCode "Set subscription to $SubscriptionId"
}
Write-Host "  Azure: $($azAccount.user) → Subscription $SubscriptionId"

gh auth status 2>&1 | Out-Null
Assert-ExitCode "GitHub CLI authentication check (run: gh auth login)"
Write-Host "  GitHub: authenticated ✓"

# ─── 1. Create resource group ───────────────────────────────────────────────

Write-Host "`n📁 Creating resource group: $ResourceGroup ($Location)..." -ForegroundColor Yellow

$existingRg = az group show --name $ResourceGroup --subscription $SubscriptionId --query name -o tsv 2>$null
if ($existingRg) {
    Write-Host "  ℹ️  Resource group already exists — reusing"
} else {
    az group create --name $ResourceGroup --location $Location --subscription $SubscriptionId --output none
    Assert-ExitCode "Create resource group $ResourceGroup"
    Write-Host "  ✅ Resource group created"
}

# ─── 2. Create OIDC app registration for GitHub Actions ─────────────────────

Write-Host "`n🔐 Creating OIDC app registration: HelkinSwarm-CICD..." -ForegroundColor Yellow

$existingApp = az ad app list --display-name "HelkinSwarm-CICD" --query "[0].appId" -o tsv 2>$null
if ($existingApp) {
    Write-Host "  ℹ️  App 'HelkinSwarm-CICD' already exists (appId: $existingApp) — reusing"
    $clientId = $existingApp
    $objectId = az ad app show --id $clientId --query id -o tsv
    Assert-ExitCode "Look up existing app object ID"
} else {
    $appOutput = az ad app create --display-name "HelkinSwarm-CICD" --query '{appId:appId,id:id}' -o json
    Assert-ExitCode "Create app registration HelkinSwarm-CICD"
    $appJson = $appOutput | ConvertFrom-Json
    $clientId = $appJson.appId
    $objectId = $appJson.id
    Write-Host "  ✅ App created (appId: $clientId)"
}

if (-not $clientId -or -not $objectId) {
    throw "Failed to resolve app registration IDs (clientId=$clientId, objectId=$objectId)"
}

# ─── 3. Create service principal ────────────────────────────────────────────

Write-Host "`n👤 Creating service principal..." -ForegroundColor Yellow

$existingSp = az ad sp show --id $clientId --query id -o tsv 2>$null
if ($existingSp) {
    Write-Host "  ℹ️  Service principal already exists"
    $spObjectId = $existingSp
} else {
    az ad sp create --id $clientId --output none
    Assert-ExitCode "Create service principal for $clientId"

    # Small delay — AAD replication can lag
    Start-Sleep -Seconds 3
    $spObjectId = az ad sp show --id $clientId --query id -o tsv
    Assert-ExitCode "Look up new service principal object ID"
    Write-Host "  ✅ Service principal created"
}

if (-not $spObjectId) {
    throw "Failed to resolve service principal object ID"
}

# ─── 4. Create federated identity credentials ───────────────────────────────
# IMPORTANT: PowerShell mangles JSON when passing inline to az CLI.
# We write to temp files to avoid quoting nightmares.

Write-Host "`n🔗 Creating federated identity credentials..." -ForegroundColor Yellow

$mainCredExists = az ad app federated-credential list --id $objectId --query "[?name=='github-main'].name" -o tsv 2>$null
if (-not $mainCredExists) {
    $mainCredFile = [System.IO.Path]::GetTempFileName()
    try {
        @{
            name      = 'github-main'
            issuer    = 'https://token.actions.githubusercontent.com'
            subject   = "repo:${GitHubRepo}:ref:refs/heads/main"
            audiences = @('api://AzureADTokenExchange')
        } | ConvertTo-Json | Set-Content -Path $mainCredFile -Encoding utf8

        az ad app federated-credential create --id $objectId --parameters "@$mainCredFile" --output none
        Assert-ExitCode "Create federated credential github-main"
        Write-Host "  ✅ Federated credential: github-main (CD on push to main)"
    } finally {
        Remove-Item $mainCredFile -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "  ℹ️  Federated credential 'github-main' already exists"
}

$prCredExists = az ad app federated-credential list --id $objectId --query "[?name=='github-pr'].name" -o tsv 2>$null
if (-not $prCredExists) {
    $prCredFile = [System.IO.Path]::GetTempFileName()
    try {
        @{
            name      = 'github-pr'
            issuer    = 'https://token.actions.githubusercontent.com'
            subject   = "repo:${GitHubRepo}:pull_request"
            audiences = @('api://AzureADTokenExchange')
        } | ConvertTo-Json | Set-Content -Path $prCredFile -Encoding utf8

        az ad app federated-credential create --id $objectId --parameters "@$prCredFile" --output none
        Assert-ExitCode "Create federated credential github-pr"
        Write-Host "  ✅ Federated credential: github-pr (CI on pull requests)"
    } finally {
        Remove-Item $prCredFile -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "  ℹ️  Federated credential 'github-pr' already exists"
}

# ─── 5. Grant Owner role on resource group ──────────────────────────────────

Write-Host "`n🛡️ Granting Owner role to OIDC service principal on $ResourceGroup..." -ForegroundColor Yellow

$existingRole = az role assignment list `
    --assignee $spObjectId `
    --role "Owner" `
    --scope "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup" `
    --query "[0].id" -o tsv 2>$null
if ($existingRole) {
    Write-Host "  ℹ️  Owner role already assigned"
} else {
    az role assignment create `
        --role "Owner" `
        --assignee-object-id $spObjectId `
        --assignee-principal-type ServicePrincipal `
        --scope "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup" `
        --output none
    Assert-ExitCode "Grant Owner role to OIDC SP on $ResourceGroup"
    Write-Host "  ✅ Owner role granted"
}

# ─── 6. Get user principal ID ───────────────────────────────────────────────

Write-Host "`n👤 Resolving user principal ID for $UserUpn..." -ForegroundColor Yellow
$userPrincipalId = az ad user show --id $UserUpn --query id -o tsv
Assert-ExitCode "Resolve user principal ID for $UserUpn"

if (-not $userPrincipalId) {
    throw "Failed to resolve user principal ID for $UserUpn"
}
Write-Host "  ✅ User Object ID: $userPrincipalId"

# ─── 7. Set GitHub repository variables ─────────────────────────────────────

Write-Host "`n📝 Setting GitHub repository variables..." -ForegroundColor Yellow

gh variable set AZURE_CLIENT_ID       --body $clientId
Assert-ExitCode "Set GitHub variable AZURE_CLIENT_ID"
gh variable set AZURE_TENANT_ID       --body $TenantId
Assert-ExitCode "Set GitHub variable AZURE_TENANT_ID"
gh variable set AZURE_SUBSCRIPTION_ID --body $SubscriptionId
Assert-ExitCode "Set GitHub variable AZURE_SUBSCRIPTION_ID"
gh variable set AZURE_RESOURCE_GROUP  --body $ResourceGroup
Assert-ExitCode "Set GitHub variable AZURE_RESOURCE_GROUP"
gh variable set USER_PRINCIPAL_ID     --body $userPrincipalId
Assert-ExitCode "Set GitHub variable USER_PRINCIPAL_ID"

Write-Host "  ✅ All 5 GitHub variables set"

# ─── 8. Initial Bicep deployment ────────────────────────────────────────────

Write-Host "`n🚀 Running initial Bicep deployment..." -ForegroundColor Yellow
Write-Host "  This will create all Azure resources (~5-10 minutes)..." -ForegroundColor DarkGray

az deployment group create `
    --resource-group $ResourceGroup `
    --template-file infra/main.bicep `
    --parameters "@infra/main.parameters.json" `
    --parameters userPrincipalId=$userPrincipalId `
    --output table
Assert-ExitCode "Bicep deployment to $ResourceGroup"
Write-Host "  ✅ Bicep deployment complete"

# ─── 9. Summary ─────────────────────────────────────────────────────────────

Write-Host "`n════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  HelkinSwarm 🤖 — Bootstrap Complete!" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Resource Group:      $ResourceGroup" -ForegroundColor White
Write-Host "  Location:            $Location" -ForegroundColor White
Write-Host "  OIDC Client ID:      $clientId" -ForegroundColor White
Write-Host "  User Principal ID:   $userPrincipalId" -ForegroundColor White
Write-Host "  GitHub Variables:    ✅ Set (5)" -ForegroundColor White
Write-Host "  Bicep Deployment:    ✅ Complete" -ForegroundColor White
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "    1. git push origin main    (triggers CD pipeline)" -ForegroundColor DarkGray
Write-Host "    2. Verify: Invoke-RestMethod https://<fqdn>/api/health" -ForegroundColor DarkGray
Write-Host ""
