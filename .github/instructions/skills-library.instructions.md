---
applyTo: "skills/**,src/capabilities/**"
---

# Skills Library Standards
**Spec ref:** `docs/skills-system-enhancement-2026-03-24v2.md`, `docs/05-Capabilities-Framework.md`, `docs/0t-Idempotency-and-External-Side-Effects.md`

## Critical Rule
Every skill **must** have a JSON manifest at `skills/<domain>/manifest.json` conforming to schema v2. No broken skills reach production — all prerequisites, credentials, and dependencies must be handled by the onboarding pipeline.

## Manifest v2 Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `domain` | string | Internal identifier (matches folder name) |
| `shortName` | string | Short internal name (e.g. `"web-search"`) |
| `displayName` | string | UI-friendly name for Skills Library tab |
| `shortDescription` | string | One-line description shown on skill card |
| `iconUrl` | string (URL) | Blob storage URL for skill icon |
| `version` | string | Semver or RC tag (`"1.0"`, `"RC-2026-03"`) |
| `deploymentScenario` | enum | `"personal-user-centric"` or `"enterprise-commercial"` |
| `onboardingMethod` | enum | `"automatic-agentic"`, `"post-install-link"`, or `"both"` |
| `lifecycleRules` | enum | `"keep-credentials"`, `"close-external-account"`, or `"ask-user"` |
| `tools` | array | Tool definitions with name, description, risk, inputSchema |

## Manifest v2 Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `dependencies` | string[] | Required skills (install blocked if missing) |
| `requiredPermissions` | string[] | Entra/Graph delegated permissions |
| `externalAccountsNeeded` | object[] | Third-party accounts required (structured entries, see below) |
| `softOnboarding` | object | First-run personality prefs (address style, response length) |
| `maintenanceTasks` | array | Scheduled/event-driven tasks (key rotation, credential refresh) |

### externalAccountsNeeded Structured Entries (#624)

Each entry in `externalAccountsNeeded` is an object:

| Field | Required | Description |
|-------|----------|-------------|
| `description` | yes | Human-readable description of the account/key |
| `envVarName` | no | Env var name for preflight resolution (operator-kv, bicep-provisioned) |
| `kvSecretName` | no | Key Vault secret name |
| `howToObtain` | no | Instructions for obtaining the credential |
| `satisfiedBy` | no | How this account is satisfied: `"operator-kv"`, `"user-vault"`, `"bicep-provisioned"`, `"oauth-link"` |
| `required` | no | When `false`, skill degrades gracefully — stays operational without this account |

**Honesty rule:** every entry MUST include `satisfiedBy` so the operational state assessor knows how to check satisfaction. Entries with `satisfiedBy: "oauth-link"` are satisfied by the user completing the OAuth flow, not by env var presence.

## Tool Definition Rules

Every tool in the `tools` array must include:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | `snake_case_with_domain` prefix (e.g. `github_list_issues`) |
| `description` | yes | Clear, concise description for LLM tool presentation |
| `risk` | yes | `"low"`, `"medium"`, or `"high"` |
| `dataSensitivity` | yes | `"non-pii"`, `"pii"`, or `"sensitive"` |
| `inputSchema` | yes | JSON Schema object for tool parameters |
| `requiresConfirmation` | yes | Boolean — medium/high risk tools require confirmation cards |
| `requiresSubAgent` | yes | Boolean — if true, runs in isolated LLM session (#315) |
| `requiresExecutor` | no | Boolean — if true, goes through executor pipeline |
| `privilegeClass` | yes | `"read-only"`, `"read-write"`, `"create"`, or `"delete"` (#316) |

### requiresSubAgent Criteria (#315)

Declare `requiresSubAgent: true` when a tool meets **any** of:
- Touches PII via Microsoft Graph (Outlook mail/calendar, Teams messages)
- Performs write operations on external systems (e.g. `github_create_issue`)
- Requires scoped token minting with specific Graph permissions
- Benefits from isolated LLM context (no conversation history bleed)

Tools that should **NOT** use sub-agents:
- Core introspection tools (health, skills, whoami)
- Stateless read-only external calls (web search, weather)
- Lightweight internal read ops (github_list_*, github_get_*)

### privilegeClass Criteria (#316)

| Class | Meaning | Scope Implication |
|-------|---------|-------------------|
| `read-only` | Reads data, no side effects | Narrowest Graph scopes (`.Read`) |
| `read-write` | Modifies existing resources | `.ReadWrite` scopes |
| `create` | Creates new resources | `.ReadWrite` or `.Send` scopes |
| `delete` | Removes resources or data | `.ReadWrite` scopes + confirmation |

## Onboarding Honesty Rules (#641, #649)

A skill's `onboardingMethod` and `externalAccountsNeeded` must truthfully reflect what the user will experience:

- **`automatic-agentic`** → skill MUST be truly operational with zero manual steps, OR declare all prerequisites (env vars, permissions, external accounts) so the assessor correctly classifies it as `operator-setup-required`
- **`post-install-link`** → skill requires user to complete an OAuth or setup link before use — classified as `action-required`
- **`operator/backend-config-required`** → skill requires backend infrastructure the user cannot self-serve — classified as `operator-setup-required`
- **A discoverable skill must never show as "operational" when it silently fails at runtime** due to missing credentials, permissions, or accounts

## Onboarding Requirements

- Every skill must declare `onboardingMethod` in its manifest
- `"automatic-agentic"` — orchestrator handles all setup (create accounts, store keys)
- `"post-install-link"` — user completes OAuth / external setup via `/link`
- `"both"` — agentic setup + user confirmation step
- No user-facing "missing config" errors allowed — trap and resolve in orchestrator

### User-Vault Credential Path — Creation Standard (#649)

When a skill needs a secret the **user must manually provide** (not operator-provisioned via Bicep), follow this canonical pattern:

1. **Manifest** — add to `externalAccountsNeeded` and declare vault dependency:
   ```json
   {
     "externalAccountsNeeded": [
       {
         "description": "Human-readable name of the credential (e.g. Twitter API v2 Bearer Token)",
         "kvSecretName": "PascalCaseName",
         "satisfiedBy": "user-vault",
         "howToObtain": "Instructions for user to obtain and store the key"
       }
     ],
     "dependencies": ["vault"]
   }
   ```
   `kvSecretName` convention: **PascalCase**, matches the User Vault KV secret name exactly.

2. **Handler** — resolve via env-var fallback then vault fetch:
   ```typescript
   import { SecretClient } from '@azure/keyvault-secrets';
   import { ManagedIdentityCredential } from '@azure/identity';

   async function resolveSecret(kvSecretName: string, envVarFallback?: string): Promise<string | null> {
     // Operator/env override (backward compat for existing deployments)
     const envVal = envVarFallback ? process.env[envVarFallback] : undefined;
     if (envVal) return envVal;
     // User Vault path (primary path for user-provided secrets)
     const vaultUri = process.env['USER_VAULT_KEY_VAULT_URI'];
     if (!vaultUri) return null;
     try {
       const client = new SecretClient(vaultUri, new ManagedIdentityCredential());
       const secret = await client.getSecret(kvSecretName);
       return secret.value ?? null;
     } catch { return null; }
   }
   ```

3. **Error message** when resolution fails — direct user to store via vault skill:
   ```
   "[Credential description] is not configured. Store it: vault_store_secret({ name: 'PascalCaseName', value: '<your-key>' })"
   ```

4. **assessor behavior**: `satisfiedBy: "user-vault"` entries classify the skill as `action-required` (not `operator-setup-required`), so the user sees a recoverable onboarding message, not an operator-only error.

**Canonical reference implementation:** `skills/x/manifest.json` + `skills/x/handlers.ts`

## Lifecycle Rules

- Every skill must declare uninstall behavior in `lifecycleRules`
- On uninstall: check for upstream dependencies first (block or warn)
- Credential cleanup: follow manifest declaration (keep, close, ask)
- Identity lifecycle tasks (key rotation, expiration) go in `maintenanceTasks`

## Dependency Rules

- Dependencies listed in `dependencies` array by skill `domain` name
- Install is blocked if required dependency is not installed
- Uninstall is blocked (or warned) if other installed skills depend on this one
- Core skills are default-installed but follow the same pipeline

## SkillForge Output Rules

- Newly forged skills from SkillForge appear as "Available" (not installed)
- Must be reviewed before installation (Special Circumstances ethos check)
- SkillForge skills land in `skills/custom/` — never in domain-specific folders

## Always
- ✅ Match tool name prefix to skill domain (`github_*` for `skills/github/`)
- ✅ Validate manifest against schema v2 before merging
- ✅ Declare all external account requirements upfront
- ✅ Include `lifecycleRules` even for read-only skills (declare `"keep-credentials"`)
- ✅ Add idempotency guards for externally visible create/update/delete side-effects near the real emit point
- ✅ When picking an icon for a new skill, choose from `visualAssets/rawIcons/` — see the registry file `visualAssets/rawIcons/ICON_REGISTRY.md` to see which files are already claimed, then record your choice there

## Never
- ❌ Do NOT ship a skill without a manifest
- ❌ Do NOT use `any` in tool inputSchema — be explicit
- ❌ Do NOT hard-code API keys — use Key Vault via managed identity
- ❌ Do NOT import between skill domains (`skills/outlook/` cannot import from `skills/github/`)
- ❌ Do NOT allow silent failures on missing credentials — surface actionable errors
- ❌ Do NOT trust the model alone to avoid duplicate external side-effects
- ❌ Do NOT add `externalAccountsNeeded` fields that require a third-party account when an Azure-native equivalent exists — prefer Azure resources deployable via Bicep (e.g. use Azure Bing Search v7 instead of Brave Search, see #623)
- ❌ Do NOT use third-party search APIs (Brave, SerpAPI, etc.) for web search — use `skills/web/` which calls Azure Bing Search v7 directly

## Key Vault Architecture (two-KV model)

Stamps have two Key Vaults:
- **Operator KV** (`kv-helkinswarm-{alias}`): application-level secrets, infra credentials, Azure resource keys (e.g. Bing Search key). Provisioned by Bicep / CICD. Skills read from this via `process.env`.
- **User Vault KV** (`kv-helkinswarm-user-{alias}`): user-facing secrets (API keys the owner manually provides, credentials for third-party SaaS skills, GitHub PATs, etc.). The `vault` skill (#178) provides read/write access to this KV. Skills that need user-managed secrets declare `externalAccountsNeeded` AND a `dependencies: ["vault"]` to signal they need the vault skill to onboard them.

When a skill needs a secret that is **auto-provisioned by Bicep** (Azure-native resource), do NOT list it in `externalAccountsNeeded` — it will be there automatically.

When a skill needs a secret that a **human or the agent must supply manually**, list it in `externalAccountsNeeded` and declare `dependencies: ["vault"]` so the system can guide the user to store the key via the vault skill.
