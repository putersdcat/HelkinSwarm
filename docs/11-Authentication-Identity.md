# HelkinSwarm Project Specification

## 11. Authentication & Identity (Refined)

### Philosophy

HelkinSwarm never holds standing privileges or long-lived secrets. Every action uses **zero-trust, short-lived, tightly scoped credentials**. This is non-negotiable for security, auditability, and future open-source or commercial use.

The system is built as a **digital body** (0l): the master orchestrator is the brain that mints credentials on demand; skills and future virtual employees (0j) are limbs that receive only the exact privileges they need for the current task.

### Core Identity Model

| Identity Type              | Purpose                                      | Lifetime      | Scope & Link to Other Specs |
|----------------------------|----------------------------------------------|---------------|-----------------------------|
| **User-Assigned Managed Identity (UAMI)** | Root runtime identity (Functions app)       | Permanent     | Minimal RBAC only; never write/delete |
| **Scoped Tokens**          | Per-tool Graph / GitHub / Azure calls        | 5 minutes     | Minimum required permissions; enforced by 0e pipeline |
| **OBO Delegated Tokens**   | Acting as the user (personal Outlook, OneDrive, etc.) | 5 minutes     | User-consent flow; used for skill-specific memory (0i) |
| **GitHub App Installation Token** | SkillForge & GitHub Enterprise access     | 60 minutes    | Repo-scoped via GitHub App; used only by SkillForge (0f) |

### Authentication Flow

1. Function App boots with its **UAMI** (injected via `AZURE_CLIENT_ID`).
2. UAMI is granted only the absolute minimum roles (Key Vault Secrets User, Cosmos DB Contributor, etc.).
3. On every tool call:
   - Scoped Token Minter creates a 5-minute token with exactly the privileges required by the capability manifest (0a).
   - Token is passed to the executor agent (never to the LLM sub-agent).
   - Token is discarded immediately after use.
4. For user-context actions (personal data in Outlook, SharePoint, etc.):
   - Onboarding flow triggers Entra consent.
   - Refresh token stored encrypted in Key Vault (auto-renew on use).
   - Short-lived OBO access token issued per call.
5. GitHub operations (SkillForge) use the dedicated GitHub App with installation tokens.

### Key Components

| Component                     | Location                              | Responsibility |
|-------------------------------|---------------------------------------|----------------|
| **Identity Service**          | `src/auth/identity.ts`                | Returns correct credential (UAMI in prod, DefaultAzureCredential locally) |
| **Scoped Token Minter**       | `src/auth/scopedTokenMinter.ts`       | 5-minute tokens per capability manifest |
| **OBO Provider**              | `src/auth/oboTokenProvider.ts`        | On-behalf-of delegated tokens for personal skills |
| **MSAL Cache**                | `src/auth/msalCachePlugin.ts`         | Cosmos-backed token cache for OBO flows |
| **GitHub App Auth**           | `src/tools/github/githubClient.ts`    | `@octokit/auth-app` with Key Vault private key (used only by SkillForge) |

### Environment Variables (All from Key Vault or Bicep)

- `AZURE_CLIENT_ID` — UAMI client ID
- `MICROSOFT_APP_ID` — Same UAMI ID (required for Bot Framework)
- `MICROSOFT_APP_TYPE=UserAssignedMsi` — Critical setting
- GitHub App secrets (`GitHubAppId`, `GitHubInstallationId`, `GitHubAppPrivateKey`)

### Local Development vs Production

- **Production**: Pure UAMI + Key Vault (zero secrets in code).
- **Local**: `DefaultAzureCredential` (falls back to `az login`, VS Code, etc.).

No connection strings, client secrets, or PATs ever appear in source or config files.

### Integration with Safety & Modularity

- Every scoped/OBO token is minted **after** the safety filter (0e) has approved the tool.
- Delegated identity is required for any skill that touches personal data — this directly powers skill-specific memory vaults (0i) and future virtual employees (0j).
- SkillForge uses GitHub App tokens exclusively — never user tokens.

### Role and Policy Authority

Current application-level authority is layered:

- `guest` → ordinary tool use only
- `owner` → ordinary tool use + policy override + high-risk policy override

Policy exception authority is intentionally stricter than ordinary tool access so stamp-local safety exceptions can be tightly scoped and auditable.

### What NOT to Do

- ❌ Never store any secret (token, key, password) in code, .env, or Bicep.
- ❌ Never use long-lived PATs or client secrets.
- ❌ Never grant the UAMI broad roles — only the absolute minimum.
- ❌ Never allow the LLM to receive or handle raw tokens.
- ❌ Never bypass the Scoped Token Minter for any tool call.