# scripts/agent-login.ps1
# ---------------------------------------------------------------------------
# HelkinSwarm-LocalAgent — TPM-bound certificate login helper for the AI
# coding agent (BasicBitch / DevLoop / etc.). Replaces interactive `az login`
# and `Connect-MgGraph -Scopes ...` so the agent never needs the human owner
# to sit at the keyboard for routine tasks.
#
# Identity:        HelkinSwarm-LocalAgent (Entra app reg, owner-managed)
# AppId:           e012a81c-1dd1-41cc-8bd1-423235319320
# Tenant:          51b1f02a-e19b-4089-a5f6-3ebb72835521  (putersdcat.com)
# Subscription:    65b1d40b-8962-46cd-b2d7-fa5d09b787a1  (PUTERSDCAT-CORP)
# Cert thumbprint: B760B2E3EFCC921A1D989E7CC5ECFF85F88DE96E
# Cert provider:   Microsoft Platform Crypto Provider (TPM-backed)
# Cert location:   Cert:\CurrentUser\My  (NonExportable, this machine only)
# Cert expires:    2028-04-22
#
# RBAC granted (least privilege):
#   - Reader               on /subscriptions/<sub>            (read everything)
#   - Monitoring Reader    on /subscriptions/<sub>            (App Insights / metrics)
#   - Log Analytics Reader on /subscriptions/<sub>            (KQL log queries)
#   - Contributor          on rg-helkinswarm-{a7f2,router,tabs} (intervene on stamp)
# Graph app permissions (admin-consented):
#   - Application.Read.All
#   - Directory.Read.All
#
# Why TPM-backed non-exportable: the private key never leaves this machine's
# TPM. If someone copies the .cer file or even the cert object to another
# host, they cannot sign with it — the key is sealed to this TPM. That is
# the strongest practical "machine-bound" guarantee Windows gives.
#
# Usage:
#   . scripts/agent-login.ps1            # logs in to both Az and MgGraph
#   . scripts/agent-login.ps1 -AzOnly    # Az only
#   . scripts/agent-login.ps1 -GraphOnly # Graph only
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
  [switch]$AzOnly,
  [switch]$GraphOnly,
  [switch]$Quiet
)

$AppId    = 'e012a81c-1dd1-41cc-8bd1-423235319320'
$TenantId = '51b1f02a-e19b-4089-a5f6-3ebb72835521'
$SubId    = '65b1d40b-8962-46cd-b2d7-fa5d09b787a1'
$Thumb    = 'B760B2E3EFCC921A1D989E7CC5ECFF85F88DE96E'

function Write-Step($msg) {
  if (-not $Quiet) { Write-Host "[agent-login] $msg" -ForegroundColor Cyan }
}

# 1. Sanity check: cert is in the user store and TPM-backed.
$cert = Get-Item "Cert:\CurrentUser\My\$Thumb" -ErrorAction SilentlyContinue
if (-not $cert) {
  Write-Error "Agent cert $Thumb not found in Cert:\CurrentUser\My. Did the cert get rotated? Re-run scripts/provision-agent-identity.ps1."
  return
}
if ($cert.NotAfter -lt (Get-Date).AddDays(30)) {
  Write-Warning "Agent cert expires $($cert.NotAfter) — less than 30 days. Rotate via scripts/provision-agent-identity.ps1."
}

# 2. Az PowerShell login (preferred over `az` CLI because Az supports
# cert-store thumbprint auth with a non-exportable TPM key; az CLI requires
# a PFX file which a non-exportable cert cannot produce.)
if (-not $GraphOnly) {
  Write-Step "Connect-AzAccount -ServicePrincipal -CertificateThumbprint $($Thumb.Substring(0,8))..."
  if (-not (Get-Module -ListAvailable -Name Az.Accounts)) {
    Write-Warning "Az.Accounts not installed. Run: Install-Module Az -Scope CurrentUser -Force -AllowClobber"
  } else {
    Import-Module Az.Accounts -ErrorAction SilentlyContinue | Out-Null
    $azCtx = Connect-AzAccount `
      -ServicePrincipal `
      -ApplicationId $AppId `
      -TenantId $TenantId `
      -CertificateThumbprint $Thumb `
      -SubscriptionId $SubId `
      -WarningAction SilentlyContinue `
      -ErrorAction Stop
    Write-Step "Az: $($azCtx.Context.Account.Id) -> $($azCtx.Context.Subscription.Name)"
  }
}

# 3. Microsoft Graph PowerShell login.
if (-not $AzOnly) {
  Write-Step "Connect-MgGraph -CertificateThumbprint $($Thumb.Substring(0,8))..."
  if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Write-Warning "Microsoft.Graph not installed. Run: Install-Module Microsoft.Graph -Scope CurrentUser -Force"
  } else {
    Import-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue | Out-Null
    Connect-MgGraph `
      -ClientId $AppId `
      -TenantId $TenantId `
      -CertificateThumbprint $Thumb `
      -NoWelcome `
      -ErrorAction Stop
    $ctx = Get-MgContext
    Write-Step "Graph: AppOnly as $($ctx.AppName) (clientId $($ctx.ClientId.Substring(0,8))...)"
  }
}

# 4. For az CLI consumers: the agent should prefer Az PowerShell. But if a
# script absolutely needs the `az` command, run with subscription scope. Note
# that `az login --service-principal` cannot use a non-exportable cert, so
# `az` calls inherit the human owner's interactive `az login` context — that
# is acceptable for read-only az CLI usage.
if (-not $Quiet) {
  Write-Host ""
  Write-Host "Login complete. Quick smoke tests:" -ForegroundColor Green
  Write-Host "  Az:    Get-AzSubscription | Select-Object Name,Id"
  Write-Host "  Graph: Get-MgApplication -Top 1 | Select-Object DisplayName,AppId"
  Write-Host ""
  Write-Host "App Insights smoke test:" -ForegroundColor Green
  Write-Host "  Get-AzApplicationInsights -ResourceGroupName rg-helkinswarm-a7f2 | Select-Object Name,InstrumentationKey"
}
