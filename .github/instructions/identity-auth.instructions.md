---
applyTo: "src/auth/**"
---

# Identity & Authentication Rules
**Spec ref:** `docs/11-Authentication-Identity.md`

## Critical Rule
HelkinSwarm **never holds standing privileges or long-lived secrets**. Every action uses zero-trust, short-lived, tightly scoped credentials minted on demand. The LLM sub-agent never receives or handles raw tokens — ever.

## Identity Model

| Identity Type | Purpose | Lifetime | Scope |
|---|---|---|---|
| **UAMI** (User-Assigned Managed Identity) | Root runtime identity for the Functions app | Permanent | Absolute minimum RBAC only |
| **Scoped Tokens** | Per-tool Graph / GitHub / Azure calls | 5 minutes | Minimum required permissions per capability manifest |
| **OBO Delegated Tokens** | Acting as the user (Outlook, OneDrive, personal data) | 5 minutes | User-consent flow; personal skills and skill memory (0i) |
| **GitHub App Installation Token** | SkillForge & GitHub Enterprise access | 60 minutes | Repo-scoped via GitHub App (used only by SkillForge) |

## Key Components

| File | Responsibility |
|------|----------------|
| `src/auth/identity.ts` | Returns correct credential — UAMI in prod, `DefaultAzureCredential` locally |
| `src/auth/scopedTokenMinter.ts` | Mints 5-minute tokens per capability manifest |
| `src/auth/oboTokenProvider.ts` | On-behalf-of delegated tokens for personal skills |
| `src/auth/msalCachePlugin.ts` | Cosmos-backed token cache for OBO flows |
| `src/tools/github/githubClient.ts` | GitHub App auth with Key Vault private key |

## Environment Variables (UAMI-injected — all from Key Vault)
- `AZURE_CLIENT_ID` — UAMI client ID
- `MICROSOFT_APP_ID` — Same UAMI ID (required for Bot Framework)
- `MICROSOFT_APP_TYPE=UserAssignedMsi` — Critical, must be set via Bicep

## Scoped Token Minting Flow
1. Safety filter (0e) approves the tool call
2. `scopedTokenMinter.ts` reads the capability manifest's declared scopes
3. Mints a 5-minute token with **exactly** those scopes — nothing more
4. Token passed to `executorActivity.ts` (not to the LLM session)
5. Token discarded immediately after use

## Local Development
- Use `DefaultAzureCredential` — falls back to `az login`, VS Code credential, or env var
- Never use PATs, client secrets, or connection strings — even locally

## Always
- ✅ Use `src/auth/identity.ts` as the single credential entry point
- ✅ Mint scoped tokens via `scopedTokenMinter.ts` — declare scopes in the capability manifest
- ✅ Store OBO refresh tokens encrypted in Key Vault (not in Cosmos directly)
- ✅ Use `DefaultAzureCredential` locally — same code path as production

## Never
- ❌ Store any secret (token, key, password) in code, `.env`, `.json`, or Bicep
- ❌ Use long-lived PATs or client secrets for any integration
- ❌ Grant the UAMI broad roles — only the absolute minimum for each resource
- ❌ Allow the LLM sub-agent to receive or reason about raw tokens
- ❌ Bypass `scopedTokenMinter.ts` for any tool call
- ❌ Use `MICROSOFT_APP_TYPE=SingleTenant` — must be `UserAssignedMsi`

*We are the bridge.*
