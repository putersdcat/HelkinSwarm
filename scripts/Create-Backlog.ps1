#!/usr/bin/env pwsh
# HelkinSwarm Full GitHub Issue Backlog Creator
# Milestone titles used (gh issue create requires title, not number)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# Milestone title constants
$M_BOOT  = 'v0.0 - Bootstrap'
$M_CORE  = 'v0.1 - Core Runtime & Teams Interface'
$M_ORCH  = 'v0.2 - Eternal Brain & Orchestration'
$M_LLM   = 'v0.3 - LLM Layer, Tool Dispatch & Safety Pipeline'
$M_MVP   = 'v1.0 - MVP Complete'
$M_POST  = 'v1.1+ - Self-Improvement & Post-MVP'

function New-GhIssue {
    param(
        [string]$Title,
        [string]$Body,
        [string[]]$Labels,
        [string]$Milestone = ''
    )
    $bodyFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $bodyFile -Value $Body -Encoding UTF8

    $ghArgs = @('issue', 'create', '--title', $Title, '--body-file', $bodyFile)
    if ($Milestone -ne '') {
        $ghArgs += '--milestone'
        $ghArgs += $Milestone
    }
    foreach ($l in $Labels) {
        $ghArgs += '--label'
        $ghArgs += $l
    }

    $result = & gh @ghArgs 2>&1
    Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue

    if ("$result" -match '(https://github\.com/[^\s]+/(\d+))') {
        $num = [int]$Matches[2]
        Write-Host "  OK #$num  $Title" -ForegroundColor Green
        return $num
    } else {
        Write-Host "  FAIL: $Title -- $result" -ForegroundColor Red
        return $null
    }
}

# Track issue numbers
$n = @{}

Write-Host "`n=== NEVER-CLOSE ISSUES ===" -ForegroundColor Cyan

$body = @'
<!-- NEVER CLOSE THIS ISSUE -->
## This issue is NEVER closed.

It is a **recurring maintenance trigger**. After each major milestone or significant delivery, an agent (or human) picks this up, executes a review + update pass, and drops a dated comment summarizing what was done.

**Spec Reference:** `docs/Delivery/01-Recurring-Maintenance-and-Introspection-Issues.md` Section 1

### Trigger Criteria (any one is sufficient)
- A milestone has been closed or is near-close
- A major Epic has been delivered
- More than 4 weeks since the last run
- A significant architecture change has landed
- A new contributor is onboarding

### Standing Checklist (review and re-execute each run)

**README.md**
- [ ] High-level descriptions, quick-start steps, architecture overview match current capabilities
- [ ] Local dev workflow, CI/CD flow, bootstrap instructions are accurate and tested
- [ ] Diagrams and example commands reflect global-first architecture with EU toggle

**Living Specification (Docs/)**
- [ ] 01-16 + 0a-0m remain aligned with implemented code
- [ ] All cross-references and "What NOT to Do" sections are valid
- [ ] New capabilities reflected in appropriate documents

**Domain-Specific Guidance and Instructions**
- [ ] All `.github/instructions/` files accurately describe current patterns
- [ ] DevLoop ignition prompt and test-harness guidance remain current

**Dead Code and Artifacts**
- [ ] Orphaned scripts, screenshots, snapshots removed or gitignored
- [ ] Noisy console.log routed through structured observability

**Security and Compliance Spot Check**
- [ ] `.env.example` contains no real secrets
- [ ] Local config files properly gitignored
- [ ] Emergency stop and maintenance mode still wired

**Package and Dependency Hygiene**
- [ ] No outdated or vulnerable packages

**GitHub Hygiene**
- [ ] Open issues have correct labels and milestone alignment
- [ ] Recurring maintenance and never-close labels are active

### Deliverable for each run
Add a dated comment with:
1. Trigger for this pass
2. Summary of what was reviewed and updated
3. Any new issues created
4. Confirmation that spec and codebase remain in sync
'@

$n['nc1'] = New-GhIssue -Title "[RECURRING] Codebase Health & Documentation Alignment - Never Close" `
    -Body $body `
    -Labels @('recurring-maintenance', 'never-close', 'documentation')

$body = @'
<!-- NEVER CLOSE THIS ISSUE -->
## This issue is NEVER closed.

This is a recurring **introspection + architectural alignment** trigger. Unlike the codebase health pass, this issue asks the higher-order questions: What would we build differently now? Where have newer patterns surpassed older implementations?

**Spec Reference:** `docs/Delivery/01-Recurring-Maintenance-and-Introspection-Issues.md` Section 2

### Trigger Criteria (any one is sufficient)
- Major Epic completed or materially reshaped
- Significant architecture or safety change landed
- More than 4 weeks since last introspection pass
- "This feels harder than it should" signal during development
- Repeated patterns/bugs suggest old design assumptions are leaking

### Standing Checklist

**1. Pattern Evolution Review**
- [ ] Identify where newer modules solve problems more cleanly than legacy paths
- [ ] Propose targeted backports of superior patterns
- [ ] Flag duplicated logic needing a single canonical implementation

**2. Objective-to-Reality Audit**
- [ ] Confirm recently delivered Epics still hold in current architecture
- [ ] Verify early assumptions and design decisions remain valid
- [ ] Highlight where done-then is only partially-true today

**3. Safety and Security Constraint Alignment**
- [ ] Re-verify four-eyes pipeline, scoped tokens, executor agents, least-privilege
- [ ] Confirm no newer flows silently bypass guardrails
- [ ] Flag design drift that could increase blast radius

**4. Forward Architecture Anti-Cornering**
- [ ] Re-evaluate trajectory for avoidable constraints
- [ ] Identify extension points needing hardening (SkillForge, DevLoop, VEs, Hydra-Net)
- [ ] Capture do-now-to-avoid-pain-later items

**5. Technical Debt Early-Warning**
- [ ] Find schema/model/capability expansions not propagated to older paths
- [ ] Identify TODO clusters or complexity spikes in core runtime
- [ ] Spot areas where modularity or digital-body ethos could be strengthened

**6. Operational Coherence**
- [ ] Validate observability, test harnesses, diagnostics map to real failure modes
- [ ] Confirm recurring signals feed architectural improvements

### Deliverable for each run
Every run adds a dated comment with:
1. What changed in our understanding
2. What should remain exactly as-is
3. What must be refactored or backported next
4. Which new issues were created or updated
5. Any explicit risk calls (safety, scalability, reliability)
'@

$n['nc2'] = New-GhIssue -Title "[RECURRING] Architecture & Design Introspection Pass - Never Close" `
    -Body $body `
    -Labels @('recurring-maintenance', 'never-close')

Start-Sleep -Seconds 2

# ================================================================
Write-Host "`n=== PHASE 0 (v0.0) BOOTSTRAP ===" -ForegroundColor Cyan
# ================================================================

$body = @'
## Epic: Repository & Infrastructure Bootstrap

**Phase:** 0 - Bootstrap | **Milestone:** v0.0
**Spec References:** 03-Tech-Stack-Infrastructure.md, 12-Deployment-CICD.md, 15-Project-Structure.md, 16-Final-Notes-and-Bootstrap.md

### Description
Stand up the complete repository structure, Azure infrastructure (Bicep), CI/CD pipelines, and verify the first deployment is live with a healthy endpoint.

### Success Criteria
- [ ] `git push main` deploys a running Container Apps app with `/api/health` returning healthy
- [ ] Bicep defines all core resources (UAMI, Key Vault, Cosmos DB, Container Apps, Bot Service, AI Services, App Insights)
- [ ] CI pipeline runs lint + compile + Bicep validate
- [ ] CD pipeline runs Bicep deploy -> Docker build -> ACR push -> Container Apps update
- [ ] Teams app manifest exists and package script generates valid zip
- [ ] EU residency toggle (`euResidencyMode`) wired in Bicep
- [ ] Zero secrets in code - all from Key Vault
'@

$n['epic_boot'] = New-GhIssue -Title "[EPIC] Repository & Infrastructure Bootstrap" -Body $body -Labels @('epic','infra','mvp') -Milestone $M_BOOT

$body = @'
## Scaffold Repository Structure

**Spec Reference:** 15-Project-Structure.md, 16-Final-Notes-and-Bootstrap.md

### Acceptance Criteria
- [ ] Directory structure matches 15-Project-Structure.md exactly
- [ ] `package.json`, `tsconfig.json`, `host.json`, `Dockerfile`, `.env.example` all present
- [ ] ESLint 9 flat config with `@typescript-eslint/recommended`
- [ ] `strict: true` in tsconfig, `module: NodeNext`
- [ ] No barrel files, no `any` types
- [ ] `.gitignore` covers all build artifacts (including local config)
- [ ] Naming conventions match spec (15-Project-Structure.md table)
'@

$n['scaffold'] = New-GhIssue -Title "Scaffold repository structure per 15-Project-Structure.md" -Body $body -Labels @('infra','mvp') -Milestone $M_BOOT

$body = @'
## Create Bicep Infrastructure (main.bicep)

**Spec Reference:** 03-Tech-Stack-Infrastructure.md, 12-Deployment-CICD.md

### Resources to Define
- Resource Group (`helkinswarm-prod-eus2`)
- User-Assigned Managed Identity (`helkinswarm-uami`)
- Container Apps Environment + Azure Functions App
- Azure Container Registry
- Key Vault
- Cosmos DB Serverless (with DiskANN containers)
- Azure AI Services (Foundry) with global/EU model deployments
- Bot Service + Teams channel
- Application Insights + Log Analytics

### Acceptance Criteria
- [ ] `param euResidencyMode bool = false` controls global vs EU stack
- [ ] All resources follow naming convention from spec
- [ ] UAMI gets minimal RBAC roles only
- [ ] Cosmos DB containers: `userProfiles`, `sessions` (72h TTL), `multimodalMemory`, `skillMemory-*`, `durableHooks`, `longRunningCatalog`, `ide-messages`
- [ ] AI Services SKU switches between GlobalStandard and DataZoneStandard
- [ ] Model deployments for primary, secondary, and embeddings
- [ ] `az deployment group create` succeeds on clean resource group
- [ ] Health check alert rules included
'@

$n['bicep'] = New-GhIssue -Title "Create Bicep infrastructure (infra/main.bicep) with EU toggle" -Body $body -Labels @('infra','mvp') -Milestone $M_BOOT

$body = @'
## CI Pipeline - Lint, Compile, Type-Check, Bicep Validate

**Spec Reference:** 12-Deployment-CICD.md

### Acceptance Criteria
- [ ] Triggers on every push + PR to all branches
- [ ] Runs: ESLint, TypeScript compile (`tsc --noEmit`), type-check
- [ ] Runs: `az bicep build` to validate Bicep
- [ ] Uses OIDC federation (no GitHub secrets for credentials)
- [ ] Fails fast on any error
- [ ] Node.js 22 LTS
'@

$n['ci'] = New-GhIssue -Title "CI pipeline - lint, compile, type-check, Bicep validate" -Body $body -Labels @('infra','mvp') -Milestone $M_BOOT

$body = @'
## CD Pipeline - Bicep Deploy, Docker Build, ACR Push, Container Apps Update

**Spec Reference:** 12-Deployment-CICD.md

### Steps
1. OIDC login to personal tenant
2. Bicep deploy `infra/main.bicep`
3. Docker build (multi-stage, Node 22)
4. Push to ACR
5. Container Apps zero-downtime revision update
6. SkillForge base image sync (when dev tooling changes)
7. Health check verification

### Acceptance Criteria
- [ ] Triggers only on push to `main`
- [ ] OIDC federation (zero secrets)
- [ ] Bicep deployment respects `euResidencyMode` parameter
- [ ] Docker image built and pushed to `helkinswarmacr`
- [ ] Container Apps revision updated with zero downtime
- [ ] Health check runs post-deployment; pipeline fails if unhealthy
- [ ] SkillForge base image synced when Dockerfile changes
'@

$n['cd'] = New-GhIssue -Title "CD pipeline - Bicep deploy, Docker build, ACR push, Container Apps update" -Body $body -Labels @('infra','mvp') -Milestone $M_BOOT

$body = @'
## Teams App Manifest & Package Script

**Spec Reference:** 10-Teams-Interface.md, 12-Deployment-CICD.md

### Acceptance Criteria
- [ ] `manifest.json` with correct bot ID, messaging endpoint, personal scope
- [ ] Color and outline icons present in `appPackage/`
- [ ] `scripts/New-TeamsAppPackage.ps1` auto-bumps version and produces zip
- [ ] `.github/workflows/teams-package.yml` (manual dispatch) produces artifact
- [ ] Generated zip passes Teams Developer Portal validation
- [ ] Messaging endpoint uses Container Apps FQDN correctly
'@

$n['tpkg'] = New-GhIssue -Title "Teams app manifest & package script" -Body $body -Labels @('infra','teams','mvp') -Milestone $M_BOOT

$body = @'
## Health Endpoint (/api/health)

**Spec Reference:** 13-Observability-Monitoring.md

### Acceptance Criteria
- [ ] Returns JSON with overall status + component breakdown
- [ ] Components checked: overseer, llm, memory, safetyMode, euResidencyMode
- [ ] Returns 200 when healthy, 503 when degraded
- [ ] Includes correlation ID
- [ ] Used by CD pipeline for post-deployment verification
- [ ] No authentication required (public endpoint)
'@

$n['health'] = New-GhIssue -Title "Health endpoint (/api/health) with component status" -Body $body -Labels @('infra','observability','mvp') -Milestone $M_BOOT

$body = @'
## Environment Variables & Key Vault Integration

**Spec Reference:** 03-Tech-Stack-Infrastructure.md, 11-Authentication-Identity.md

### Required Variables
- `LLM_MODEL_PRIMARY` / `LLM_MODEL_SECONDARY`
- `AZURE_AI_FOUNDRY_ENDPOINT`
- `euResidencyMode`
- `COSMOS_ENDPOINT`
- `AZURE_CLIENT_ID` (UAMI)
- `MICROSOFT_APP_ID` / `MICROSOFT_APP_TYPE=UserAssignedMsi`
- `SKILLFORGE_ENABLED`
- `SAFETY_MODE`

### Acceptance Criteria
- [ ] All variables sourced from Key Vault or Bicep outputs
- [ ] `.env.example` documents every variable (no real values)
- [ ] Zod-validated config loader (`src/config/`)
- [ ] Clear error messages on missing/invalid config
- [ ] Zero secrets in source code
'@

$n['env'] = New-GhIssue -Title "Environment variables & Key Vault integration" -Body $body -Labels @('infra','auth','mvp') -Milestone $M_BOOT

$body = @'
## Local Development Setup & Bootstrap Guide

**Spec Reference:** 16-Final-Notes-and-Bootstrap.md

### Acceptance Criteria
- [ ] README.md contains clear quick-start steps
- [ ] One-time bootstrap via `az deployment group create` documented
- [ ] `DefaultAzureCredential` works locally (az login fallback)
- [ ] Local `func start` runs with mock or real Foundry endpoint
- [ ] Bot Framework Emulator connection documented
- [ ] `pnpm install && pnpm build && pnpm start` works
'@

$n['localdev'] = New-GhIssue -Title "Local development setup & bootstrap guide" -Body $body -Labels @('infra','documentation','mvp') -Milestone $M_BOOT

Start-Sleep -Seconds 2

# ================================================================
Write-Host "`n=== PHASE 1 (v0.1) CORE RUNTIME & TEAMS ===" -ForegroundColor Cyan
# ================================================================

$body = @'
## Epic: Teams Bot Interface

**Phase:** 1 - Core Runtime & Teams Interface | **Milestone:** v0.1
**Spec References:** 10-Teams-Interface.md, 0e (safety gates), 0h (durable hooks)

### Success Criteria
- [ ] Bot responds to @mentions in Teams
- [ ] Immediate ack pattern (Working on it...) with in-place update
- [ ] Proactive replies work via stored conversation references
- [ ] Slash commands handled before overseer (/emergency-stop, /forge, /heavy, /light)
- [ ] Emergency stop and resume endpoints functional
- [ ] Maintenance mode gracefully rejects new messages
- [ ] Adaptive Card human confirmation framework operational
'@

$n['epic_teams'] = New-GhIssue -Title "[EPIC] Teams Bot Interface" -Body $body -Labels @('epic','teams','mvp') -Milestone $M_CORE

$body = @'
## Bot Framework Adapter with MSI Auth

**Spec Reference:** 10-Teams-Interface.md, 11-Authentication-Identity.md

### Acceptance Criteria
- [ ] `CloudAdapter` configured with UAMI
- [ ] `MICROSOFT_APP_TYPE=UserAssignedMsi` respected
- [ ] Error handler logs to App Insights with correlation ID
- [ ] Adapter registered as Azure Function HTTP trigger (`/api/messages`)
- [ ] Works in both local dev (DefaultAzureCredential) and production (UAMI)
'@

$n['adapter'] = New-GhIssue -Title "Bot Framework adapter with MSI auth (src/bot/adapter.ts)" -Body $body -Labels @('teams','auth','mvp') -Milestone $M_CORE

$body = @'
## Activity Handler - Message Routing & Maintenance Mode

**Spec Reference:** 10-Teams-Interface.md

### Acceptance Criteria
- [ ] Extends `TeamsActivityHandler`
- [ ] Routes @mention messages to the overseer via Durable external event
- [ ] Checks maintenance mode flag before processing
- [ ] Sends immediate ack (Working on it...)
- [ ] Stores conversation reference for proactive replies
- [ ] Handles `onMembersAdded` for greeting
- [ ] Logs all incoming messages with correlation ID (no PII in logs)
'@

$n['handler'] = New-GhIssue -Title "Activity handler - message routing & maintenance mode" -Body $body -Labels @('teams','mvp') -Milestone $M_CORE

$body = @'
## Proactive Reply Mechanism & Conversation Store

**Spec Reference:** 10-Teams-Interface.md, 0h (durable hooks need proactive updates)

### Acceptance Criteria
- [ ] Stores conversation references in Cosmos DB
- [ ] `sendReplyActivity.ts` can send proactive messages using stored refs
- [ ] Ack messages can be replaced in-place with final reply
- [ ] Durable hook triggers can push notifications proactively (0h integration point)
- [ ] Works across Container Apps restarts (persisted in Cosmos)
'@

$n['proactive'] = New-GhIssue -Title "Proactive reply mechanism & conversation store" -Body $body -Labels @('teams','mvp') -Milestone $M_CORE

$body = @'
## Human Confirmation Cards (Adaptive Cards)

**Spec Reference:** 10-Teams-Interface.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

### Acceptance Criteria
- [ ] Generates clear Adaptive Card with impact description and risk level badge
- [ ] Approve / Cancel buttons with 5-minute auto-timeout
- [ ] Button click raises Durable external event back to overseer
- [ ] Cards sent via ack-update mechanism for seamless UX
- [ ] Auto-cancels on timeout with user notification
- [ ] Integrated with safety pipeline risk tiers (0e)
'@

$n['confirm'] = New-GhIssue -Title "Human confirmation cards (Adaptive Cards) for safety pipeline" -Body $body -Labels @('teams','safety','mvp') -Milestone $M_CORE

$body = @'
## Slash Commands Handler

**Spec Reference:** 10-Teams-Interface.md

### Commands
| Command | Access | Action |
|---------|--------|--------|
| `/emergency-stop` | Owner | Global shutdown |
| `/emergency-resume` | Owner | Restore service |
| `/forge <idea>` | Owner | Routes to SkillForge (0f) |
| `/heavy <prompt>` | Owner | Forces global frontier model |
| `/light <prompt>` | Owner | Forces fast global model |

### Acceptance Criteria
- [ ] Commands intercepted before overseer
- [ ] Owner-only commands verified against known user ID
- [ ] `/emergency-stop` triggers immediate global shutdown
- [ ] `/forge` routes to SkillForge when enabled
- [ ] `/heavy` and `/light` set model override for that turn
'@

$n['slash'] = New-GhIssue -Title "Slash commands handler (/emergency-stop, /forge, /heavy, /light)" -Body $body -Labels @('teams','mvp') -Milestone $M_CORE

$body = @'
## Maintenance Mode & Emergency Stop

**Spec Reference:** 10-Teams-Interface.md, 04-Safety-Architecture.md

### Acceptance Criteria
- [ ] `POST /api/emergency-stop` (protected) sets maintenance mode
- [ ] Terminates all running orchestrators when triggered
- [ ] Replies "I'm offline" to any new messages while in maintenance mode
- [ ] `POST /api/emergency-resume` (owner only) restores service
- [ ] Flag persisted in Cosmos (survives restarts)
- [ ] Logged to App Insights as P0 event
'@

$n['maint'] = New-GhIssue -Title "Maintenance mode & emergency stop/resume endpoints" -Body $body -Labels @('teams','safety','mvp') -Milestone $M_CORE

# --- Auth Epic ---

$body = @'
## Epic: Authentication & Identity

**Phase:** 1 - Core Runtime | **Milestone:** v0.1
**Spec References:** 11-Authentication-Identity.md, 0d, 0e

### Success Criteria
- [ ] UAMI works in production, DefaultAzureCredential locally
- [ ] Scoped Token Minter issues 5-minute tokens per capability manifest
- [ ] OBO flow operational for personal-scope tools
- [ ] GitHub App auth ready for SkillForge
- [ ] User onboarding flow (Entra consent) works end-to-end
- [ ] No secrets in code - all from Key Vault
'@

$n['epic_auth'] = New-GhIssue -Title "[EPIC] Authentication & Identity" -Body $body -Labels @('epic','auth','mvp') -Milestone $M_CORE

$body = @'
## Identity Service (UAMI + DefaultAzureCredential)

**Spec Reference:** 11-Authentication-Identity.md

### Acceptance Criteria
- [ ] Returns UAMI credential when `AZURE_CLIENT_ID` is set
- [ ] Falls back to `DefaultAzureCredential` for local dev
- [ ] Singleton pattern (one credential instance)
- [ ] Used by all downstream Azure SDK clients
'@

$n['identity'] = New-GhIssue -Title "Identity service - UAMI + DefaultAzureCredential (src/auth/identity.ts)" -Body $body -Labels @('auth','mvp') -Milestone $M_CORE

$body = @'
## Scoped Token Minter

**Spec Reference:** 11-Authentication-Identity.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

### Acceptance Criteria
- [ ] Reads required scope from tool capability manifest
- [ ] Mints tokens scoped to exactly those permissions
- [ ] 5-minute lifetime, non-renewable
- [ ] Delete-only tokens never given to LLM-bearing sessions
- [ ] Every mint logged to App Insights with correlation ID
- [ ] Integrated with safety pipeline (0e) - mints only after approval
'@

$n['minter'] = New-GhIssue -Title "Scoped Token Minter - 5-minute least-privilege tokens" -Body $body -Labels @('auth','safety','mvp') -Milestone $M_CORE

$body = @'
## OBO Delegated Token Provider

**Spec Reference:** 11-Authentication-Identity.md, 0d-Enhanced-Safety-Segregation

### Acceptance Criteria
- [ ] On-behalf-of token exchange with Entra ID
- [ ] 5-minute access tokens per call
- [ ] Refresh token stored encrypted in Key Vault
- [ ] Auto-renewal on use
- [ ] Revocation when user removes consent in Entra
'@

$n['obo'] = New-GhIssue -Title "OBO delegated token provider for personal-scope tools" -Body $body -Labels @('auth','mvp') -Milestone $M_CORE

$body = @'
## MSAL Cosmos-Backed Cache Plugin

**Spec Reference:** 11-Authentication-Identity.md

### Acceptance Criteria
- [ ] Implements MSAL ICachePlugin interface
- [ ] Stores encrypted tokens in Cosmos DB
- [ ] Works with OBO flow token refresh
- [ ] Survives container restarts
'@

$n['msal'] = New-GhIssue -Title "MSAL Cosmos-backed token cache plugin" -Body $body -Labels @('auth','memory','mvp') -Milestone $M_CORE

$body = @'
## User Onboarding Flow (Entra Consent)

**Spec Reference:** 0d-Enhanced-Safety-Segregation Section 5

### Flow
1. User runs `/link <domain>` in Teams
2. Bootstrap sub-agent redirects to Entra consent screen
3. User consents -> refresh token stored encrypted in Key Vault
4. Subsequent requests use short-lived scoped access tokens

### Acceptance Criteria
- [ ] `/link` command triggers consent flow
- [ ] Entra consent screen shows correct permissions
- [ ] Refresh token stored securely in Key Vault
- [ ] Subsequent calls use fresh short-lived tokens
- [ ] Revocation: removing consent in Entra invalidates tokens
'@

$n['onboard'] = New-GhIssue -Title "User onboarding flow - Entra consent & delegated identity" -Body $body -Labels @('auth','teams','mvp') -Milestone $M_CORE

# --- E2E Testing Epic ---

$body = @'
## Epic: E2E Testing Foundation

**Phase:** 1 - Core Runtime | **Milestone:** v0.1
**Spec References:** 14-Testing-E2E.md

### Success Criteria
- [ ] Teams Test Harness MCP server operational
- [ ] `teams_test_full_probe` works end-to-end
- [ ] Hardcoded safe chat ID prevents accidental messages
- [ ] Test results include health, correlation ID, elapsed time
'@

$n['epic_test'] = New-GhIssue -Title "[EPIC] E2E Testing Foundation" -Body $body -Labels @('epic','testing','mvp') -Milestone $M_CORE

$body = @'
## Teams Test Harness MCP Server

**Spec Reference:** 14-Testing-E2E.md

### Tools to Implement
| Tool | Purpose |
|------|---------|
| `teams_test_full_probe` | Send + wait + correlate in one call |
| `teams_test_send_probe` | Send message only |
| `teams_test_get_recent` | Read recent messages |
| `teams_test_wait_for_bot_reply` | Poll for reply |
| `teams_test_correlate_runtime` | Fetch health + session status |

### Acceptance Criteria
- [ ] Hardcoded safe chat ID - impossible to send to wrong chat
- [ ] Uses Graph API for message injection
- [ ] `teams_test_full_probe` returns pass/fail + botReply + health + correlationId
- [ ] Registered in `.vscode/mcp.json`
- [ ] **No Playwright** for message sending
'@

$n['harness'] = New-GhIssue -Title "Teams Test Harness MCP server implementation" -Body $body -Labels @('testing','mvp') -Milestone $M_CORE

Start-Sleep -Seconds 2

# ================================================================
Write-Host "`n=== PHASE 2 (v0.2) ORCHESTRATION ===" -ForegroundColor Cyan
# ================================================================

$body = @'
## Epic: Eternal Overseer & Session Orchestration

**Phase:** 2 - Eternal Brain | **Milestone:** v0.2
**Spec References:** 08-Orchestrator-Patterns.md, 0h (durable hooks)

### Success Criteria
- [ ] Overseer runs as eternal Durable orchestration
- [ ] Survives context collapse via ContinueAsNew + summarization
- [ ] Session sub-orchestrator handles one complete turn
- [ ] Token budget tracking (80% threshold) triggers summarization
- [ ] External events (NewMessage, ConfirmationResponse) work correctly
- [ ] State persists across Container Apps restarts
'@

$n['epic_orch'] = New-GhIssue -Title "[EPIC] Eternal Overseer & Session Orchestration" -Body $body -Labels @('epic','orchestrator','mvp') -Milestone $M_ORCH

$body = @'
## Eternal Overseer (overseer.ts)

**Spec Reference:** 08-Orchestrator-Patterns.md

### Acceptance Criteria
- [ ] Registered as Durable Orchestration
- [ ] Processes one message per cycle
- [ ] `ContinueAsNew()` at 80% token budget with carried-over summary
- [ ] Handles `NewMessage` external event from bot
- [ ] Handles `ConfirmationResponse` from human confirmation cards
- [ ] Deterministic - no side effects in orchestrator body
- [ ] Survives Container Apps restarts
'@

$n['overseer'] = New-GhIssue -Title "Eternal Overseer - persistent Durable orchestration (overseer.ts)" -Body $body -Labels @('orchestrator','mvp') -Milestone $M_ORCH

$body = @'
## Session Sub-Orchestrator (sessionOrchestrator.ts)

**Spec Reference:** 08-Orchestrator-Patterns.md

### Flow
1. Load just-in-time skill memory vaults (0i integration point)
2. Apply Hydra-Net multimodal embeddings if needed (0k integration point)
3. Build prompt (persona + history + tools + model profile)
4. Call LLM (global frontier default)
5. Dispatch tool calls
6. Run full safety/verification pipeline (0e)
7. Register durable hooks if long-running (0h)
8. Return final result to overseer

### Acceptance Criteria
- [ ] Runs as Durable sub-orchestration
- [ ] Calls activities for all side effects
- [ ] Returns structured result to overseer
- [ ] Handles multi-step tool calling (iterative)
- [ ] Supports model override from /heavy and /light commands
'@

$n['session'] = New-GhIssue -Title "Session Sub-Orchestrator - one-turn execution (sessionOrchestrator.ts)" -Body $body -Labels @('orchestrator','mvp') -Milestone $M_ORCH

$body = @'
## Token Budget Tracking & ContinueAsNew Summarization

**Spec Reference:** 08-Orchestrator-Patterns.md

### Acceptance Criteria
- [ ] Accurate token counting for context window
- [ ] 80% threshold triggers summarization activity
- [ ] Summary + selected skill memory chunks injected into new session
- [ ] ContinueAsNew called after summarization
- [ ] Context preserved logically across restarts
- [ ] Long-running conversations (days/weeks) maintain coherent state
'@

$n['budget'] = New-GhIssue -Title "Token budget tracking & ContinueAsNew summarization" -Body $body -Labels @('orchestrator','mvp') -Milestone $M_ORCH

$body = @'
## State Manager - Session Context from Cosmos

**Spec Reference:** 08-Orchestrator-Patterns.md

### Acceptance Criteria
- [ ] Loads session state from `sessions` container
- [ ] Stores updated state after each turn
- [ ] Respects 72h TTL on sessions container
- [ ] Handles first-message initialization (new session creation)
- [ ] Partition key: userId
'@

$n['state'] = New-GhIssue -Title "State manager - session context persistence (Cosmos DB)" -Body $body -Labels @('orchestrator','memory','mvp') -Milestone $M_ORCH

$body = @'
## Prompt Builder Skeleton

**Spec Reference:** 08-Orchestrator-Patterns.md, 06-Tool-Dispatch-LLM-Layer.md

### Acceptance Criteria
- [ ] Activity function (no side effects in orchestrator)
- [ ] Injects persona (from `src/persona/`)
- [ ] Includes conversation history (summarized if post-ContinueAsNew)
- [ ] Includes filtered tool list from registry
- [ ] Extension points for skill memory injection (0i) and Hydra-Net (0k)
- [ ] Respects model-specific profile masks (0b) when available
'@

$n['prompt'] = New-GhIssue -Title "Prompt builder - persona + history + tools assembly" -Body $body -Labels @('orchestrator','llm','mvp') -Milestone $M_ORCH

Start-Sleep -Seconds 2

# ================================================================
Write-Host "`n=== PHASE 3 (v0.3) LLM, TOOLS & SAFETY ===" -ForegroundColor Cyan
# ================================================================

$body = @'
## Epic: LLM Layer & Model Routing

**Phase:** 3 | **Milestone:** v0.3
**Spec References:** 06-Tool-Dispatch-LLM-Layer.md, 0b, 0c

### Success Criteria
- [ ] Model router selects correct model based on EU toggle
- [ ] Foundry client works with both global and EU models
- [ ] Sub-agent sessions run in complete isolation
- [ ] EU toggle changes models without code changes
- [ ] Extension point for BYOK/external providers (0c)
'@

$n['epic_llm'] = New-GhIssue -Title "[EPIC] LLM Layer & Model Routing" -Body $body -Labels @('epic','llm','mvp') -Milestone $M_LLM

$body = @'
## Model Router - Global Frontier Default, EU Toggle

**Spec Reference:** 06-Tool-Dispatch-LLM-Layer.md

### Routing Logic
- Default (`euResidencyMode = false`): Best global frontier models
- EU mode (`euResidencyMode = true`): DataZoneStandard models only
- `/heavy` override -> global frontier primary
- `/light` override -> fast global secondary

### Acceptance Criteria
- [ ] Reads `euResidencyMode` from config
- [ ] Returns correct primary, secondary, and embedding model names
- [ ] Supports per-turn model override from slash commands
- [ ] No hard-coded model names in any other file
- [ ] Extension point for future BYOK providers (0c)
'@

$n['router'] = New-GhIssue -Title "Model router - global frontier default with EU toggle" -Body $body -Labels @('llm','mvp') -Milestone $M_LLM

$body = @'
## Foundry Client Abstraction

**Spec Reference:** 06-Tool-Dispatch-LLM-Layer.md

### Acceptance Criteria
- [ ] Automatically adapts parameters for reasoning vs standard models
- [ ] Supports function calling (tool_calls) with OpenAI-compatible schema
- [ ] Handles streaming responses
- [ ] Token usage tracking per call
- [ ] Error handling with retry logic
- [ ] Extension point for BYOK external providers (0c)
- [ ] Uses UAMI credentials for Azure AI Foundry
'@

$n['foundry'] = New-GhIssue -Title "Foundry client abstraction - provider-agnostic LLM interface" -Body $body -Labels @('llm','mvp') -Milestone $M_LLM

$body = @'
## Sub-Agent Isolation - Fresh LLM Sessions

**Spec Reference:** 06-Tool-Dispatch-LLM-Layer.md

### Isolation Rules
- No shared conversation history with main overseer
- Uses secondary (faster) model by default
- Receives only minimal context for the specific tool
- Cannot call other tools recursively

### Acceptance Criteria
- [ ] Fresh LLM session per tool call
- [ ] No context leakage from main overseer
- [ ] Secondary model used by default
- [ ] Minimal context injection (only what needed)
- [ ] No recursive tool calling
- [ ] Results returned to orchestrator for verification
'@

$n['subagent'] = New-GhIssue -Title "Sub-agent isolation - fresh LLM sessions per tool call" -Body $body -Labels @('llm','orchestrator','safety','mvp') -Milestone $M_LLM

# --- Capabilities Framework Epic ---

$body = @'
## Epic: Capabilities Framework & Tool Dispatch

**Phase:** 3 | **Milestone:** v0.3
**Spec References:** 05-Capabilities-Framework.md, 0a-Modularity-and-Config.md

### Success Criteria
- [ ] Skills auto-discovered from `skills/*/manifest.json`
- [ ] Manifests validated by Zod schema
- [ ] Central tool registry provides OpenAI-compatible function schemas
- [ ] Tool dispatch activity routes calls correctly
- [ ] Safety filter removes tools based on current mode
- [ ] Hot-reload supported for SkillForge merges
'@

$n['epic_cap'] = New-GhIssue -Title "[EPIC] Capabilities Framework & Tool Dispatch" -Body $body -Labels @('epic','modularity','mvp') -Milestone $M_LLM

$body = @'
## Capability Loader - Skills Auto-Discovery

**Spec Reference:** 05-Capabilities-Framework.md

### Acceptance Criteria
- [ ] Scans `skills/*/manifest.json` at startup
- [ ] Validates each manifest against central Zod schema
- [ ] Registers every tool in the Tool Registry
- [ ] Hot-reload on SkillForge merge (file watcher or API trigger)
- [ ] Applies model-specific masks from active profiles (0b) when available
- [ ] Supports multiple skills library paths (future: remote repos)
- [ ] Graceful error handling for invalid manifests (skip + log)
'@

$n['loader'] = New-GhIssue -Title "Capability loader - skills auto-discovery & Zod validation" -Body $body -Labels @('modularity','mvp') -Milestone $M_LLM

$body = @'
## Central Tool Registry

**Spec Reference:** 05-Capabilities-Framework.md

### Acceptance Criteria
- [ ] All tools registered with function schema, handler reference, risk metadata
- [ ] LLM only sees filtered subset (based on safety mode, model lane, active profile)
- [ ] Provides `getToolsForModel(modelId)` that applies profile masks
- [ ] Supports registration from capability loader + MCP bridge
- [ ] Thread-safe for hot-reload scenarios
'@

$n['registry'] = New-GhIssue -Title "Central tool registry (toolRegistry.ts)" -Body $body -Labels @('modularity','llm','mvp') -Milestone $M_LLM

$body = @'
## Tool Dispatch Activity

**Spec Reference:** 06-Tool-Dispatch-LLM-Layer.md

### Flow
1. Receive tool_call from LLM
2. Look up handler in Tool Registry
3. Safety filter + risk check
4. Mint scoped token via Scoped Token Minter
5. Execute handler (or delegate to Executor Agent for high-risk)
6. Run full verification pipeline (0e)
7. Return result

### Acceptance Criteria
- [ ] Routes to correct handler based on tool name
- [ ] Enforces safety pipeline before and after execution
- [ ] Mints scoped tokens per call
- [ ] High-risk actions delegated to executor agents
- [ ] Results flow through verification pipeline
- [ ] Logged with correlation ID
'@

$n['dispatch'] = New-GhIssue -Title "Tool dispatch activity - routing with safety pipeline integration" -Body $body -Labels @('orchestrator','safety','mvp') -Milestone $M_LLM

$body = @'
## Capability Manifest Schema (Zod)

**Spec Reference:** 05-Capabilities-Framework.md

### Required Fields
- `domain`, `version`, `tools[]`
- Per tool: `name`, `description`, `risk`, `dataSensitivity`, `allowedModelLane`
- `requiresConfirmation`, `externalAutomationCapabilities`, `longTermMemorySchema`
- `inputSchema`, `outputSchema`

### Acceptance Criteria
- [ ] Zod schema covers all fields from spec
- [ ] Validates risk levels (low/medium/high)
- [ ] Validates dataSensitivity (pii/non-pii/mixed)
- [ ] Validates allowedModelLane (any/global/eu-only)
- [ ] TypeScript types generated from Zod schema
- [ ] Used by capability loader at startup
'@

$n['schema'] = New-GhIssue -Title "Capability manifest Zod schema & TypeScript types" -Body $body -Labels @('modularity','mvp') -Milestone $M_LLM

# --- Safety Pipeline Epic ---

$body = @'
## Epic: Safety & Four-Eyes Verification Pipeline

**Phase:** 3 | **Milestone:** v0.3
**Spec References:** 04-Safety-Architecture.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md, 0d

### Pipeline Steps (sequential, all mandatory)
1. Schema Validation
2. Data Minimization
3. Spot-Check Verification
4. Prompt Shields (Azure Content Safety)
5. Risk-Tiered Human Confirmation

### Success Criteria
- [ ] All steps mandatory; failure aborts turn
- [ ] Executor agents for high-risk actions (no LLM in execution path)
- [ ] No bypass flags anywhere in codebase
- [ ] SkillForge output runs through the same pipeline
- [ ] Full audit trail in App Insights
- [ ] `confirmation-gated` is the default safety mode
'@

$n['epic_safe'] = New-GhIssue -Title "[EPIC] Safety & Four-Eyes Verification Pipeline" -Body $body -Labels @('epic','safety','mvp') -Milestone $M_LLM

$body = @'
## Schema Validation Step

**Spec Reference:** 0e Step 1

### Acceptance Criteria
- [ ] Strict JSON schema check against manifest outputSchema
- [ ] Failure -> drop response, log anomaly, notify user
- [ ] Prevents hallucinated fields or adversarial text
- [ ] Logged with correlation ID
'@

$n['sv'] = New-GhIssue -Title "Safety pipeline: Schema validation step" -Body $body -Labels @('safety','mvp') -Milestone $M_LLM

$body = @'
## Data Minimization Step

**Spec Reference:** 0e Step 2

### Acceptance Criteria
- [ ] Strips all fields not in outputSchema
- [ ] Reduces token usage and attack surface
- [ ] Example: search tool returns only messageIds, senders - never full bodies
- [ ] Logged with before/after snapshot
'@

$n['dm'] = New-GhIssue -Title "Safety pipeline: Data minimization step" -Body $body -Labels @('safety','mvp') -Milestone $M_LLM

$body = @'
## Spot-Check Verification Step

**Spec Reference:** 0e Step 3

### Logic
- 10 or fewer results -> verify ALL IDs via narrow batched GET
- More than 10 results -> random sample of 5 (configurable)
- Compare against original query pattern
- Mismatch -> flag suspicious, log, ask user

### Acceptance Criteria
- [ ] Verification via narrow Graph/API filters (only needed fields selected)
- [ ] Typically less than 200 tokens total
- [ ] Mismatch triggers user clarification or abort
- [ ] Configurable sample size
- [ ] Can be disabled per-tool only for ultra-low-risk metadata
'@

$n['sc'] = New-GhIssue -Title "Safety pipeline: Spot-check verification step" -Body $body -Labels @('safety','mvp') -Milestone $M_LLM

$body = @'
## Prompt Shields Integration (Azure Content Safety)

**Spec Reference:** 0e Step 4, 04-Safety-Architecture.md

### Invocation Points
1. On incoming user message (before routing)
2. On sub-agent output (before orchestrator reasoning)

### Acceptance Criteria
- [ ] Blocks jailbreak attempts and adversarial injections
- [ ] Skipped only inside orchestrator trusted internal reasoning loop
- [ ] Detection results logged to App Insights
- [ ] P0 alert on repeated detections
'@

$n['ps'] = New-GhIssue -Title "Safety pipeline: Prompt Shields (Azure Content Safety)" -Body $body -Labels @('safety','mvp') -Milestone $M_LLM

$body = @'
## Executor Agents for Destructive Actions

**Spec Reference:** 0e Section 3, 0d, 04-Safety-Architecture.md

### Design Rules
- Delete/move/create actions NEVER use an LLM sub-agent
- Executor receives only vetted, spot-checked ID list
- Payload cryptographically signed (session ID + hash of original read output)
- Rejects anything that does not match

### Acceptance Criteria
- [ ] No LLM in execution path for destructive actions
- [ ] Receives signed payload from verification pipeline
- [ ] Validates hash of original read output
- [ ] Rejects mismatched payloads
- [ ] Uses scoped delete-only tokens
- [ ] Full audit trail
'@

$n['exec'] = New-GhIssue -Title "Executor agents - non-LLM destructive action handlers" -Body $body -Labels @('safety','orchestrator','mvp') -Milestone $M_LLM

$body = @'
## Safety Mode Configuration

**Spec Reference:** 04-Safety-Architecture.md

### Modes
| Mode | Behaviour | Default |
|------|-----------|---------|
| `read-only` | No write/delete tokens minted | |
| `confirmation-gated` | All medium+ risk require human confirmation | **Yes** |
| `full-destructive` | High-risk still requires confirmation; low-risk auto-executes | |

### Acceptance Criteria
- [ ] `safetyMode` set in Bicep (`param safetyMode string = 'confirmation-gated'`)
- [ ] Cannot be changed at runtime without redeploy
- [ ] Applied universally (including SkillForge and future VEs)
- [ ] `read-only` mode prevents all write token minting
- [ ] Reported in /api/health response
'@

$n['smode'] = New-GhIssue -Title "Safety mode configuration (read-only / confirmation-gated / full-destructive)" -Body $body -Labels @('safety','infra','mvp') -Milestone $M_LLM

Start-Sleep -Seconds 2

# ================================================================
Write-Host "`n=== PHASE 4 (v1.0) MVP COMPLETE ===" -ForegroundColor Cyan
# ================================================================

# --- Memory Epic ---

$body = @'
## Epic: Memory Manager & DiskANN Vector Memory

**Phase:** 4 - MVP Complete | **Milestone:** v1.0
**Spec References:** 07-Memory-Manager.md, 0i, 0k

### Success Criteria
- [ ] MemoryManager API (store, recall, skill-scoped)
- [ ] All Cosmos containers operational with correct TTLs
- [ ] DiskANN vector index enables semantic recall
- [ ] EU toggle switches memory to EU endpoints
- [ ] Integration with overseer, prompt builder, and safety pipeline
'@

$n['epic_mem'] = New-GhIssue -Title "[EPIC] Memory Manager & DiskANN Vector Memory" -Body $body -Labels @('epic','memory','mvp') -Milestone $M_MVP

$body = @'
## MemoryManager API

**Spec Reference:** 07-Memory-Manager.md

### API Surface
- `store(content, skillId?, tags, metadata)` - store a memory (skill-scoped)
- `recall(query, skillId?, topK, minScore, modalities?)` - semantic recall
- `getSkillVault(skillId)` - read skill-specific vault
- `upsertSkillMemory(skillId, data)` - update skill vault

### Acceptance Criteria
- [ ] All memory access goes through MemoryManager (no direct Cosmos writes)
- [ ] Skill-scoped by default
- [ ] Uses DiskANN vector index for semantic recall
- [ ] Supports topK + minScore filtering
- [ ] Extension point for multimodal modalities (0k)
- [ ] Data minimizer runs before storing sensitive data (0e)
'@

$n['memapi'] = New-GhIssue -Title "MemoryManager API - store, recall, skill-scoped operations" -Body $body -Labels @('memory','mvp') -Milestone $M_MVP

$body = @'
## Cosmos DB Containers & TTL Setup

**Spec Reference:** 07-Memory-Manager.md

### Containers
| Container | TTL | Partition Key |
|-----------|-----|---------------|
| `userProfiles` | None | userId |
| `sessions` | 72h | userId |
| `multimodalMemory` | 365d | userId |
| `skillMemory-{skillId}` | 365d | userId |
| `durableHooks` | configurable | userId |
| `longRunningCatalog` | None | userId |
| `ide-messages` | 7d | correlationId |

### Acceptance Criteria
- [ ] All containers defined in Bicep
- [ ] TTLs enforced at container level
- [ ] Partition keys correct
- [ ] DiskANN vector index on relevant containers (3072 dimensions, cosine)
'@

$n['cosmos'] = New-GhIssue -Title "Cosmos DB containers & TTL setup (Bicep)" -Body $body -Labels @('memory','infra','mvp') -Milestone $M_MVP

$body = @'
## EU Residency Toggle for Memory Layer

**Spec Reference:** 07-Memory-Manager.md

### Acceptance Criteria
- [ ] `euResidencyMode = true` switches Cosmos to EU endpoint
- [ ] Embedding model switches to EU variant
- [ ] No data leaves EU boundary when enabled
- [ ] Transparent to all consumers of MemoryManager
'@

$n['memeu'] = New-GhIssue -Title "EU residency toggle for memory layer" -Body $body -Labels @('memory','infra','mvp') -Milestone $M_MVP

# --- Skill-Specific Memory Epic ---

$body = @'
## Epic: Skill-Specific Memory & Just-in-Time Injection

**Phase:** 4 | **Milestone:** v1.0
**Spec References:** 0i-Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md

### Success Criteria
- [ ] Skill vaults isolated per skill, user-scoped
- [ ] Just-in-time injection adds zero measurable latency
- [ ] Central catalog supports natural-language queries
- [ ] Onboarding ritual auto-discovers external state
- [ ] Memory survives orchestrator restarts
'@

$n['epic_smem'] = New-GhIssue -Title "[EPIC] Skill-Specific Memory & Just-in-Time Injection" -Body $body -Labels @('epic','memory','mvp') -Milestone $M_MVP

$body = @'
## Skill-Specific Memory Vaults

**Spec Reference:** 0i Core Concepts

### Acceptance Criteria
- [ ] `skillMemory-{skillId}` containers/partitions created dynamically
- [ ] User-scoped partition key
- [ ] DiskANN vector index per skill vault
- [ ] Encrypted at rest
- [ ] One skill cannot read another vault without orchestrator mediation
- [ ] "Forget everything about X skill" command supported
'@

$n['svault'] = New-GhIssue -Title "Skill-specific memory vaults (per-skill Cosmos containers)" -Body $body -Labels @('memory','mvp') -Milestone $M_MVP

$body = @'
## Just-in-Time Memory Injection into Prompts

**Spec Reference:** 0i Just-in-Time Flow

### Flow
1. Orchestrator decides "use movie skill"
2. Memory Manager pulls relevant chunks from that skill vault
3. Injected into sub-agent prompt ONLY for that turn
4. After action, skill reports new memory items back to vault

### Acceptance Criteria
- [ ] Only relevant skill memory injected (never all vaults)
- [ ] Top-K semantic retrieval with min score threshold
- [ ] Zero measurable latency added to normal turns
- [ ] New learned information stored back to vault post-action
'@

$n['jit'] = New-GhIssue -Title "Just-in-time memory injection into sub-agent prompts" -Body $body -Labels @('memory','orchestrator','mvp') -Milestone $M_MVP

$body = @'
## Central Catalog & Skill Onboarding Ritual

**Spec Reference:** 0i Central Catalog + Onboarding Ritual

### Acceptance Criteria
- [ ] `longRunningCatalog` updated on every vault change
- [ ] "Show me all my automations" returns clean list from catalog
- [ ] Onboarding ritual auto-discovers existing external state (rules, subscriptions, accounts)
- [ ] Natural-language queries supported
- [ ] No sub-agents needed for catalog queries
'@

$n['catalog'] = New-GhIssue -Title "Central catalog & automatic skill onboarding ritual" -Body $body -Labels @('memory','modularity','mvp') -Milestone $M_MVP

# --- Hydra-Net Epic ---

$body = @'
## Epic: Hydra-Net Multimodal Embeddings

**Phase:** 4 | **Milestone:** v1.0
**Spec References:** 0k-Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md

### Success Criteria
- [ ] Embedding router dispatches to correct model per content type
- [ ] Multi-vector memory storage (text + image + speech in parallel)
- [ ] Cross-modal semantic search works
- [ ] EU toggle switches all embedding models
'@

$n['epic_hydra'] = New-GhIssue -Title "[EPIC] Hydra-Net Multimodal Embeddings" -Body $body -Labels @('epic','hydra-net','mvp') -Milestone $M_MVP

$body = @'
## Embedding Router Service

**Spec Reference:** 0k Target Architecture

### Dispatch Rules
- Text -> `text-embedding-3-large`
- Images/Screenshots/PDFs -> Azure Vision / Document Intelligence
- Speech/Transcripts -> Azure AI Speech + text fallback

### Acceptance Criteria
- [ ] Automatic content type detection
- [ ] Correct model dispatched per type
- [ ] Unified vector + metadata stored in Cosmos
- [ ] EU toggle switches all models
- [ ] Content Safety runs on all uploads before embedding
'@

$n['embed'] = New-GhIssue -Title "Hydra-Net embedding router - multimodal dispatch" -Body $body -Labels @('hydra-net','mvp') -Milestone $M_MVP

$body = @'
## Cross-Modal Semantic Search

**Spec Reference:** 0k Semantic Cross-Modal Search

### Acceptance Criteria
- [ ] Image embeddings indexed alongside text
- [ ] Cross-modal queries return results in <3 seconds
- [ ] Top-K filtering across modalities
- [ ] Memory Manager extension: `recall(query, modalities: ['text', 'image'])`
'@

$n['xmodal'] = New-GhIssue -Title "Cross-modal semantic search (text + image + speech)" -Body $body -Labels @('hydra-net','memory','mvp') -Milestone $M_MVP

# --- Durable Hooks Epic ---

$body = @'
## Epic: Durable Hooks & Long-Running Workflows

**Phase:** 4 | **Milestone:** v1.0
**Spec References:** 0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md

### Core Principle: Native Delegation First
If the external system has native automation (Exchange rules, Graph subscriptions, webhooks), delegate to it first.

### Success Criteria
- [ ] Durable hooks persist across ContinueAsNew
- [ ] Webhook listener handles Event Grid / Graph subscriptions
- [ ] Skill manifests declare externalAutomationCapabilities
- [ ] Fuzzy resolution matches inbound replies
- [ ] Doctor-email workflow works end-to-end
'@

$n['epic_hook'] = New-GhIssue -Title "[EPIC] Durable Hooks & Long-Running Workflows" -Body $body -Labels @('epic','durable-hooks','mvp') -Milestone $M_MVP

$body = @'
## Durable Hook Engine

**Spec Reference:** 0h Durable Hook Engine

### Acceptance Criteria
- [ ] Hooks stored as Durable Entities
- [ ] Survive orchestrator restarts (ContinueAsNew)
- [ ] Support multiple trigger sources (webhook, Graph subscription, timer)
- [ ] Central catalog entry created for each hook
- [ ] Emergency stop kills all hooks for a user
- [ ] Max lifetime with auto-expire
'@

$n['hook'] = New-GhIssue -Title "Durable hook engine - persistent workflow entities" -Body $body -Labels @('durable-hooks','orchestrator','mvp') -Milestone $M_MVP

$body = @'
## Webhook Listener & Graph Subscription Management

**Spec Reference:** 0h Target Architecture

### Acceptance Criteria
- [ ] Event Grid trigger in Azure Functions
- [ ] Graph subscription creation + automatic renewal
- [ ] Exchange rule sync support
- [ ] Events route to correct durable hook
- [ ] Delegated user identity used for subscriptions
'@

$n['webhook'] = New-GhIssue -Title "Webhook listener & Graph subscription management" -Body $body -Labels @('durable-hooks','mvp') -Milestone $M_MVP

$body = @'
## Fuzzy Resolution & Tentative Actions

**Spec Reference:** 0h Fuzzy Resolution

### Example: Doctor Email Workflow
1. Send email -> durable hook watches for reply
2. Reply arrives -> parse options -> create tentative calendar entries
3. Notify user with one-tap confirm card

### Acceptance Criteria
- [ ] Semantic + sender + subject fuzzy matching
- [ ] Tentative actions (calendar, booking) created in pending state
- [ ] User confirmation via Adaptive Card for all pending actions
- [ ] Doctor-email workflow end-to-end test passes
'@

$n['fuzzy'] = New-GhIssue -Title "Fuzzy resolution & tentative actions for durable hooks" -Body $body -Labels @('durable-hooks','mvp') -Milestone $M_MVP

# --- SkillForge Epic ---

$body = @'
## Epic: SkillForge Ephemeral Skill Creator

**Phase:** 4 | **Milestone:** v1.0
**Spec References:** 0f-SkillForge-Ephemeral-Skill-Creator.md, 0d, 0e

### Success Criteria
- [ ] Ephemeral Docker container spins up on demand
- [ ] GitHub App auth for PR creation
- [ ] Full sandbox (outbound-only, no internal access)
- [ ] Output runs through full safety pipeline (0e)
- [ ] Hot-reload on merge
'@

$n['epic_sf'] = New-GhIssue -Title "[EPIC] SkillForge Ephemeral Skill Creator" -Body $body -Labels @('epic','skillforge','mvp') -Milestone $M_MVP

$body = @'
## SkillForge Container Architecture & Base Image

**Spec Reference:** 0f Container Architecture

### Base Image Contents
- Node 22 + pnpm, TypeScript, ESLint, Prettier, tsc
- gh CLI, Playwright, git, curl
- Warm npm cache from main repo lockfile
- Skill manifest templates

### Acceptance Criteria
- [ ] `HelkinSwarm-skillforge:base` image built and cached in ACR
- [ ] Sub-10-second cold start
- [ ] Rebuild triggered on dev tooling changes
- [ ] Resource guardrails: CPU cap, memory cap, 15-min timeout
- [ ] No sudo, no DinD, no host mounts
'@

$n['sfimg'] = New-GhIssue -Title "SkillForge container architecture & base image" -Body $body -Labels @('skillforge','infra','mvp') -Milestone $M_MVP

$body = @'
## SkillForge GitHub App Integration

**Spec Reference:** 0f Authentication, 11-Authentication-Identity.md

### Acceptance Criteria
- [ ] Dedicated GitHub App (private, org-installed)
- [ ] Private key stored in Key Vault
- [ ] RS256 JWT + installation token exchange
- [ ] Scoped: repo contents read/write + pull requests write only
- [ ] Token auto-refreshes for long jobs
- [ ] Used only by SkillForge (never user tokens)
'@

$n['sfgh'] = New-GhIssue -Title "SkillForge GitHub App auth for PR creation" -Body $body -Labels @('skillforge','auth','mvp') -Milestone $M_MVP

$body = @'
## SkillForge Prompt, Sandbox & Security Boundaries

**Spec Reference:** 0f Sandbox and Security Boundaries + Prompt

### Security Rules
- Outbound-only firewall (npm, docs, APIs allowed)
- Zero Entra/Graph tokens injected
- Ephemeral filesystem - destroyed on exit
- Prompt Shields on every LLM thought + code gen step
- CPU >80% for 5 min -> auto-kill + alert

### Acceptance Criteria
- [ ] Fixed system prompt loaded from `skillforge-prompt.md`
- [ ] Network: outbound-only, internal endpoints blocked
- [ ] Zero Entra/Graph tokens
- [ ] Prompt Shields applied continuously
- [ ] Resource guardrails enforced
- [ ] Complete audit trail in App Insights
'@

$n['sfbox'] = New-GhIssue -Title "SkillForge sandbox, security boundaries & prompt" -Body $body -Labels @('skillforge','safety','mvp') -Milestone $M_MVP

$body = @'
## Hot-Reload on SkillForge Merge

**Spec Reference:** 0f Output and Integration + 0a

### Flow
1. SkillForge opens PR
2. GitHub Actions runs security scan, jailbreak check, dependency scan
3. Human reviews + merges
4. Capability loader hot-reloads on next orchestration (or via `/reload skills`)

### Acceptance Criteria
- [ ] Merged skill detected automatically
- [ ] Capability loader refreshes without restart
- [ ] `/reload skills` command works as manual trigger
- [ ] New skill appears in tool registry immediately
'@

$n['sfhot'] = New-GhIssue -Title "Hot-reload capability loader on SkillForge merge" -Body $body -Labels @('skillforge','modularity','mvp') -Milestone $M_MVP

# --- Modularity Epic ---

$body = @'
## Epic: Modularity & Configuration Strategy

**Phase:** 4 | **Milestone:** v1.0
**Spec References:** 0a-Modularity-and-Config.md

### Success Criteria
- [ ] Core never touched for new skills
- [ ] Skills auto-discovered from configurable paths
- [ ] Central config layer (env vars + future config.json)
- [ ] Multiple libraries supported simultaneously (future)
'@

$n['epic_mod'] = New-GhIssue -Title "[EPIC] Modularity & Configuration Strategy" -Body $body -Labels @('epic','modularity','mvp') -Milestone $M_MVP

$body = @'
## Core vs Skills Library Separation

**Spec Reference:** 0a Core vs Skills Library

### Acceptance Criteria
- [ ] `src/` contains only core code
- [ ] `skills/` contains all domain-specific tools
- [ ] No tool implementations in `src/` (only registry + loader)
- [ ] Adding a new skill requires zero changes to core
'@

$n['coresep'] = New-GhIssue -Title "Enforce core vs skills library architectural separation" -Body $body -Labels @('modularity','mvp') -Milestone $M_MVP

$body = @'
## Central Configuration Layer

**Spec Reference:** 0a Configuration Strategy

### Layers (in order of precedence)
1. Environment Variables (primary for MVP)
2. Central Config File (future: `helkinswarm.config.json`)
3. Runtime Database (Cosmos `config` container for per-user overrides)

### Acceptance Criteria
- [ ] All configurable values lifted out of code
- [ ] Zod-validated config loader
- [ ] No buried strings, hard-coded paths, or magic constants
- [ ] Extension point for per-user runtime overrides
'@

$n['config'] = New-GhIssue -Title "Central configuration layer (env vars + future config.json)" -Body $body -Labels @('modularity','mvp') -Milestone $M_MVP

# --- Observability Epic ---

$body = @'
## Epic: Observability & Monitoring Dashboard

**Phase:** 4 | **Milestone:** v1.0
**Spec References:** 13-Observability-Monitoring.md

### Success Criteria
- [ ] All key telemetry events logged with correlation IDs
- [ ] Dev Console tab shows sessions, traces, memory, durable hooks, DevLoop health
- [ ] P0 alerting rules for EU violations, emergency stop, rate limits
- [ ] No raw PII in logs
'@

$n['epic_obs'] = New-GhIssue -Title "[EPIC] Observability & Monitoring Dashboard" -Body $body -Labels @('epic','observability','mvp') -Milestone $M_MVP

$body = @'
## Structured Telemetry Events

**Spec Reference:** 13-Observability-Monitoring.md

### Events
- `TurnStarted` / `TurnCompleted`
- `PromptShieldResult`
- `ToolExecuted` (with risk level, lane, duration, skillId)
- `ScopedTokenMinted`
- `VerificationPipelineResult`
- `HumanConfirmationRequested`
- `DurableHookRegistered` / `DurableHookTriggered`
- `SkillMemoryInjected`
- `HydraNetEmbedding`
- `ContinueAsNewTriggered`
- `EUResidencyViolation` (P0)
- `DevLoopSteerReceived`

### Acceptance Criteria
- [ ] All events use consistent schema
- [ ] Correlation ID attached to every event
- [ ] No raw PII logged (user IDs only)
- [ ] App Insights SDK properly initialized
'@

$n['telem'] = New-GhIssue -Title "Structured telemetry events - all key events with correlation IDs" -Body $body -Labels @('observability','mvp') -Milestone $M_MVP

$body = @'
## Correlation ID Propagation

**Spec Reference:** 13-Observability-Monitoring.md

### Propagation Path
Bot Framework -> Overseer -> LLM call -> tool execution -> sub-agent -> verification -> durable hook -> skill memory -> Hydra-Net -> DevLoop relay

### Acceptance Criteria
- [ ] ID assigned at message arrival
- [ ] Propagated through all activities and sub-orchestrations
- [ ] Included in all App Insights events
- [ ] Searchable -> shows complete end-to-end trace
- [ ] Visible in Dev Console tab
'@

$n['corr'] = New-GhIssue -Title "Correlation ID propagation across entire request lifecycle" -Body $body -Labels @('observability','mvp') -Milestone $M_MVP

$body = @'
## Dev Console Tab (Owner Only)

**Spec Reference:** 13-Observability-Monitoring.md, 10-Teams-Interface.md

### Features
- Live session list + kill buttons
- Recent traces with correlation search
- Model health cards + rate-limit headroom
- Cost breakdown
- Durable hook status
- Skill memory summary per skill
- DevLoop relay health
- Emergency stop controls

### Acceptance Criteria
- [ ] Teams personal tab at `/api/tab/dev-console`
- [ ] Owner-only access (verified against known user ID)
- [ ] Real-time session data
- [ ] Correlation search functional
- [ ] All component statuses visible
'@

$n['devconsole'] = New-GhIssue -Title "Dev Console tab - owner-only deep inspection" -Body $body -Labels @('observability','teams','mvp') -Milestone $M_MVP

$body = @'
## Alerting Rules (Bicep)

**Spec Reference:** 13-Observability-Monitoring.md

### P0 Alerts
- EU residency violation
- Emergency stop triggered
- Rate-limit exhaustion on frontier models
- Verification pipeline failure on high-risk action
- Durable hook timeout or repeated failures

### Acceptance Criteria
- [ ] All P0 rules defined in Bicep
- [ ] Deployed automatically with infrastructure
- [ ] Alert actions configured (email, Teams notification)
- [ ] Tested with simulated events
'@

$n['alerts'] = New-GhIssue -Title "P0 alerting rules in Bicep (EU violation, emergency stop, rate limits)" -Body $body -Labels @('observability','infra','mvp') -Milestone $M_MVP

# --- Agent System Epic ---

$body = @'
## Epic: Agent Definitions & Instruction System

**Phase:** 4 | **Milestone:** v1.0
**Spec References:** docs/Delivery/02-Agent-Definitions-and-Instruction-System.md

### Success Criteria
- [ ] 3 agent files created (AzureAgent, BasicBitch, DevLoop)
- [ ] 12 instruction files created per spec
- [ ] Root copilot-instructions.md updated
- [ ] All cross-reference living specification
- [ ] Referenced in DevLoop ignition prompt
'@

$n['epic_agent'] = New-GhIssue -Title "[EPIC] Agent Definitions & Instruction System" -Body $body -Labels @('epic','agent-system','mvp') -Milestone $M_MVP

$body = @'
## Create .github/agents/ - Agent Personas

**Spec Reference:** 02-Agent-Definitions-and-Instruction-System.md Section 2

### Agents
- **AzureAgent.agent.md** - Execution engine for infrastructure/resource management
- **BasicBitch.agent.md** - General-purpose iterative task executor
- **DevLoop.agent.md** - IDE-side self-improvement partner (TIK-TOK cycle, radio protocol)

### Acceptance Criteria
- [ ] Each agent is self-contained with clear persona
- [ ] References living specification (01-16 + 0a-0m)
- [ ] References the two Never-Close issues
- [ ] Loadable by DevLoop, SkillForge, or external MCP server
'@

$n['agents'] = New-GhIssue -Title "Create .github/agents/ - AzureAgent, BasicBitch, DevLoop personas" -Body $body -Labels @('agent-system','mvp') -Milestone $M_MVP

$body = @'
## Create .github/instructions/ - Domain-Specific Rules

**Spec Reference:** 02-Agent-Definitions-and-Instruction-System.md Section 3

### Files
1. `bot-framework.instructions.md`
2. `cicd.instructions.md`
3. `codebase-structure.instructions.md`
4. `devloop-harness.instructions.md`
5. `identity-auth.instructions.md`
6. `integration-manifests.instructions.md`
7. `llm-models.instructions.md`
8. `mcp-skills.instructions.md`
9. `memory-cosmos.instructions.md`
10. `orchestrator-patterns.instructions.md`
11. `safety-architecture.instructions.md`
12. `teams-testing.instructions.md`

### Acceptance Criteria
- [ ] Each file starts with clear Critical Rule or Fundamental Constraint
- [ ] Includes Always and Never sections
- [ ] Cross-references relevant spec section
- [ ] Referenced in DevLoop ignition prompt
- [ ] Reviewed in recurring maintenance passes
'@

$n['instr'] = New-GhIssue -Title "Create .github/instructions/ - 12 domain-specific rule files" -Body $body -Labels @('agent-system','mvp') -Milestone $M_MVP

# --- Ethos Epic ---

$body = @'
## Epic: Abstract Ethos & Special Circumstances Integration

**Phase:** Ongoing (applies to every layer from Day 1) | **Milestone:** v1.0
**Spec References:** 0l-Abstract-Ethos-and-Special-Circumstances-Directive.md

### Core Tenets
- "We are the bridge" - give the butterfly a body
- "We build a digital body" - master = brain, skills = reflexes
- "We delegate, never reinvent" - native automation first
- "We remember only what matters" - just-in-time, skill-scoped
- "We scale you, not ourselves" - virtual employees sleep until needed

### Success Criteria
- [ ] Every skill manifest declares externalAutomationCapabilities and longTermMemorySchema
- [ ] SkillForge checklist includes Special Circumstances Review
- [ ] DevLoop can query ethos alignment and score it
- [ ] Persona templates carry the full ethos
- [ ] Future readers of codebase understand the Culture reference
'@

$n['epic_ethos'] = New-GhIssue -Title "[EPIC] Abstract Ethos & Special Circumstances Integration" -Body $body -Labels @('epic','ethos') -Milestone $M_MVP

$body = @'
## Persona & Directive Templates

**Spec Reference:** 0l Integration Points

### Acceptance Criteria
- [ ] `dronePersona.md` with full Culture reference and ethos
- [ ] Persona loaded into every prompt via prompt builder
- [ ] Key guiding phrases included in system prompts
- [ ] Virtual employee spawn templates inherit persona + ethos
'@

$n['persona'] = New-GhIssue -Title "Persona & directive templates - dronePersona.md" -Body $body -Labels @('ethos') -Milestone $M_MVP

Start-Sleep -Seconds 2

# ================================================================
Write-Host "`n=== PHASE 5 (v1.1+) SELF-IMPROVEMENT ===" -ForegroundColor Cyan
# ================================================================

# --- DevLoop Epic ---

$body = @'
## Epic: DevLoop Bidirectional Relay

**Phase:** 5 - Post-MVP | **Milestone:** v1.1+
**Spec References:** 0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md, 09-DevLoop-Self-Improvement.md

### Success Criteria
- [ ] DevLoop can send DEVQUERY and receive structured reply within <8 seconds
- [ ] Session resurrection works after forced termination
- [ ] Full trace in Dev Console tab
- [ ] Protocol schema versioned and backward-compatible
'@

$n['epic_dl'] = New-GhIssue -Title "[EPIC] DevLoop Bidirectional Relay" -Body $body -Labels @('epic','devloop') -Milestone $M_POST

$body = @'
## Durable Functions Relay Container (ide-messages)

**Spec Reference:** 0g Target Architecture

### Acceptance Criteria
- [ ] `ide-messages` Cosmos container operational
- [ ] Push (DevLoop -> Runtime) and pull (runtime -> DevLoop) supported
- [ ] Messages persisted with 7-day TTL
- [ ] Correlation IDs for all relay messages
- [ ] App Insights tags every message with `devloop-correlation-id`
'@

$n['relay'] = New-GhIssue -Title "DevLoop relay - Durable Functions + Cosmos ide-messages container" -Body $body -Labels @('devloop','orchestrator') -Milestone $M_POST

$body = @'
## DevLoop Protocol Schema

**Spec Reference:** 0g Protocol Evolution

### Message Types
- `DEVQUERY` - IDE asks runtime a question
- `DEVLOOP` - IDE sends a steering injection
- `HELKIN-REPLY` - Runtime responds to query
- `SWARM-TOOL-REPORT` - Runtime reports tool state

### Acceptance Criteria
- [ ] Schema versioned and backward-compatible
- [ ] Human-auditable prefixes retained
- [ ] Supports steering injections (non-terminating)
- [ ] Supports session resurrection commands
'@

$n['proto'] = New-GhIssue -Title "DevLoop protocol schema (DEVQUERY, DEVLOOP, HELKIN-REPLY)" -Body $body -Labels @('devloop') -Milestone $M_POST

$body = @'
## DevLoop Interrogation Tools

**Spec Reference:** 0g Key Use Cases, 09-DevLoop-Self-Improvement.md

### Supported Queries
- "Tell me what tools you see right now and which model is routing them"
- "Dump current tool aliasing for model X"
- Safety validation (send adversarial prompts through shields)
- Session resurrection command
- Self-tuning reports

### Acceptance Criteria
- [ ] Responds to DEVQUERY: list all current tools within <8 seconds
- [ ] Returns accurate, structured tool registry dump
- [ ] Session resurrection works after forced termination
- [ ] Adversarial prompt testing supported
- [ ] DevLoop emergency kill switch (DEVLOOP-KILL) aborts sessions
'@

$n['interr'] = New-GhIssue -Title "DevLoop interrogation tools - runtime self-reporting" -Body $body -Labels @('devloop') -Milestone $M_POST

# --- Self-Tuning Epic ---

$body = @'
## Epic: Model-Specific Tool Presentation & Self-Tuning Loop

**Phase:** 5 | **Milestone:** v1.1+
**Spec References:** 0b, 0m-Agentic-Tooling-Evaluation-Automation-and-Self-Tuning-Loop.md

### Success Criteria
- [ ] Model profiles (mask files) define per-model tool presentation
- [ ] Self-tuning loop runs autonomously
- [ ] Monte-Carlo benchmarking across models
- [ ] Regression guard with auto-rollback
- [ ] >=90% success rate on benchmark suite
'@

$n['epic_st'] = New-GhIssue -Title "[EPIC] Model-Specific Tool Presentation & Self-Tuning Loop" -Body $body -Labels @('epic','self-tuning','devloop') -Milestone $M_POST

$body = @'
## Model Profile Format & Store

**Spec Reference:** 0b Model Profile Format, 0m Mask File Format

### Acceptance Criteria
- [ ] Profiles stored in `model-profiles/<model-id>/`
- [ ] Versioned and committed to Git
- [ ] Validated by Zod schema
- [ ] Loaded by profile applicator at runtime
'@

$n['mprof'] = New-GhIssue -Title "Model profile (mask file) format & Git-tracked store" -Body $body -Labels @('self-tuning','llm') -Milestone $M_POST

$body = @'
## Self-Tuning Evaluation Loop

**Spec Reference:** 0m Self-Tuning Evaluation Loop

### Workflow
1. Discovery - probe_limits for model
2. Hypothesis Generation - Create 3-5 candidate masks
3. Monte-Carlo Benchmarking - 100+ tasks
4. Scoring and Promotion - Weighted score selects winner
5. Regression Guard - >=10% drop -> auto-rollback + alert

### Acceptance Criteria
- [ ] Autonomous loop with zero human intervention
- [ ] Mask updates >=95% autonomous
- [ ] Regression alerts <2 per quarter
- [ ] Every mask change creates GitHub Issue with before/after charts
- [ ] CI/CD hook on mask or capability change
'@

$n['stloop'] = New-GhIssue -Title "Self-tuning evaluation loop (discovery to benchmark to promote)" -Body $body -Labels @('self-tuning','devloop') -Milestone $M_POST

$body = @'
## Monte-Carlo Benchmarking Framework

**Spec Reference:** 0m Monte-Carlo Benchmarking

### Scoring Dimensions
- Success rate
- Latency
- Token efficiency
- Safety compliance
- Verification pass rate

### Acceptance Criteria
- [ ] Supports 100+ synthetic + real enterprise tasks
- [ ] Parallel evaluation (up to 10 concurrent model variants)
- [ ] Results stored in Git-tracked eval store
- [ ] Public baseline integration (MCP-Bench, awesome-ai-eval)
- [ ] DevLoop adapts public tasks to internal tool signatures
'@

$n['bench'] = New-GhIssue -Title "Monte-Carlo benchmarking framework for model profiles" -Body $body -Labels @('self-tuning','testing') -Milestone $M_POST

# --- BYOK Epic ---

$body = @'
## Epic: BYOK External LLM Support

**Phase:** 5 | **Milestone:** v1.1+
**Spec References:** 0c-BYOK-External-LLM-Support.md

### Success Criteria
- [ ] OpenRouter BYOK calls work through model router
- [ ] Azure Content Safety proxy mandatory for all external calls
- [ ] Model profiles and self-tuning work on parity
- [ ] Bicep parameter for LLM provider selection
'@

$n['epic_byok'] = New-GhIssue -Title "[EPIC] BYOK External LLM Support" -Body $body -Labels @('epic','byok','llm') -Milestone $M_POST

$body = @'
## External Proxy Layer (OpenRouter BYOK)

**Spec Reference:** 0c Architecture for MVP

### Flow
1. Prompt -> Azure Content Safety (mandatory)
2. Sanitized prompt -> Model Router
3. Router forwards to OpenRouter with user key
4. Response -> same verification pipeline

### Acceptance Criteria
- [ ] OpenRouter calls routed through proxy
- [ ] Azure Content Safety runs before every external call
- [ ] User API key stored securely (Key Vault)
- [ ] Same verification pipeline applies to responses
- [ ] Token cost tracking where available
'@

$n['proxy'] = New-GhIssue -Title "External proxy layer - OpenRouter BYOK with Content Safety" -Body $body -Labels @('byok','llm','safety') -Milestone $M_POST

$body = @'
## Bicep LLM Provider Parameter

**Spec Reference:** 0c IaC / Bicep Handling

### Acceptance Criteria
- [ ] `llmProvider = azure` -> Foundry (default)
- [ ] `llmProvider = openrouter` -> external proxy with BYOK
- [ ] Primary/secondary model names configurable for any provider
- [ ] Key stored in Key Vault, not Bicep
'@

$n['bprov'] = New-GhIssue -Title "Bicep LLM provider parameter (azure / openrouter)" -Body $body -Labels @('byok','infra') -Milestone $M_POST

# --- Virtual Employees Epic ---

$body = @'
## Epic: Virtual Employees & Nested Orchestrators (Post-MVP)

**Phase:** 5 | **Milestone:** v1.1+
**Spec References:** 0j-Virtual-Employees-and-Nested-Orchestrators.md

### Success Criteria
- [ ] Master can spawn a virtual employee
- [ ] Employee inherits durable hooks + skill memory
- [ ] Bidirectional relay works for steering
- [ ] Scale-to-zero when idle
- [ ] "List all virtual employees" command works
'@

$n['epic_ve'] = New-GhIssue -Title "[EPIC] Virtual Employees & Nested Orchestrators (Post-MVP)" -Body $body -Labels @('epic','virtual-employees') -Milestone $M_POST

$body = @'
## Virtual Employee Factory

**Spec Reference:** 0j Target Architecture

### Spawn Flow
1. Command: "Create a secretary virtual employee with phone-answering tools"
2. Clone master deployment via Bicep template + IaC parameters
3. Inject unique Entra identity, persona file, restricted capability manifest
4. Register durable hooks and central catalog entry

### Acceptance Criteria
- [ ] Employee created as complete, containerized instance
- [ ] Own orchestrator, memory vaults, durable hooks
- [ ] Unique Entra App Registration (least-privilege)
- [ ] Event-driven awakening (never always-on)
- [ ] Scale-to-zero when idle
'@

$n['vef'] = New-GhIssue -Title "Virtual employee factory - spawn nested instances" -Body $body -Labels @('virtual-employees','orchestrator') -Milestone $M_POST

$body = @'
## Virtual Employee Persona & Restricted Capabilities

**Spec Reference:** 0j Persona File

### Acceptance Criteria
- [ ] Dedicated `persona.md` per employee
- [ ] Skill manifest override (narrow tools only)
- [ ] Custom guardrails per persona
- [ ] Employee cannot expand own toolset without master/SkillForge review
- [ ] Master retains kill switch for any employee
'@

$n['vep'] = New-GhIssue -Title "Virtual employee persona files & restricted capability manifests" -Body $body -Labels @('virtual-employees') -Milestone $M_POST

Start-Sleep -Seconds 1

# ================================================================
# MASTER PLAN TRACKER
# ================================================================
Write-Host "`n=== MASTER PLAN TRACKER ===" -ForegroundColor Cyan

$masterBody = @"
## Master Plan - Development & Delivery Tracking

**Spec Reference:** docs/Delivery/00-Development-&-Delivery-Master-Plan.md

### Phase Tracking
- [ ] **Phase 0 (v0.0)** - Bootstrap: Repo scaffold, Bicep, CI/CD, health endpoint
- [ ] **Phase 0.5** - Backlog Initialization: Full GitHub issue backlog created
- [ ] **Phase 1 (v0.1)** - Core Runtime: Teams bot, auth, E2E testing foundation
- [ ] **Phase 2 (v0.2)** - Orchestration: Eternal overseer, session orchestrator
- [ ] **Phase 3 (v0.3)** - LLM & Safety: Model routing, tool dispatch, four-eyes pipeline
- [ ] **Phase 4 (v1.0)** - MVP Complete: Memory, SkillForge, Hydra-Net, observability
- [ ] **Phase 5 (v1.1+)** - Self-Improvement: DevLoop relay, self-tuning, VEs, BYOK

### Never-Close Issues
- #$($n['nc1']) - Codebase Health & Documentation Alignment
- #$($n['nc2']) - Architecture & Design Introspection Pass

### Living Specification
All issues trace directly back to the living specification (docs/01-16 + 0a-0m) and the delivery documents (docs/Delivery/).
"@

$n['master'] = New-GhIssue -Title "[MASTER] Development & Delivery Plan Tracker" -Body $masterBody -Labels @('epic','documentation') -Milestone $M_BOOT

Write-Host "`n=== COMPLETE ===" -ForegroundColor Cyan
Write-Host "Total issues created: $($n.Count)" -ForegroundColor Green
Write-Host ""
$n.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host "  $($_.Name) = #$($_.Value)" }
