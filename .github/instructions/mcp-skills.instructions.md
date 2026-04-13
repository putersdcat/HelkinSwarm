---
applyTo: "skills/**"
---

# MCP Skills & Capability Manifests Rules
**Spec ref:** `docs/05-Capabilities-Framework.md`, `docs/0a-Modularity-and-Config.md`, `docs/0f-SkillForge-Ephemeral-Skill-Creator.md`

## Critical Rule
Every tool in the skills library **must** have a capability manifest (`manifest.json`) with `risk`, `dataSensitivity`, `allowedModelLane`, `externalAutomationCapabilities`, and `longTermMemorySchema` declared. Omitting these fields breaks the safety pipeline and memory injection.

## Folder Structure

```
skills/
├── core/          # Built-in always-present tools (never remove these)
├── outlook/
│   ├── manifest.json
│   └── tools/     # Tool implementation files
├── teams/
├── github/
├── azure/
└── custom/        # SkillForge landing zone — hot-reloadable
```

Each domain folder has exactly one `manifest.json` and a `tools/` subfolder.

## Capability Manifest Schema (Zod-validated at load time)

```json
{
  "domain": "outlook",
  "shortName": "outlook",
  "displayName": "Outlook Email",
  "shortDescription": "Access and manage Outlook email, calendar, and contacts",
  "iconUrl": "https://storage.example.com/skills/outlook.png",
  "version": "1.0",
  "deploymentScenario": "personal-user-centric",
  "onboardingMethod": "post-install-link",
  "lifecycleRules": "keep-credentials",
  "tools": [
    {
      "name": "outlook_list_emails",
      "description": "List emails in a mailbox with optional filters",
      "risk": "low",
      "dataSensitivity": "pii",
      "allowedModelLane": "any",
      "requiresConfirmation": false,
      "externalAutomationCapabilities": [
        { "type": "exchangeRule", "action": "createRule" }
      ],
      "longTermMemorySchema": ["blockList"],
      "inputSchema": { ... },
      "outputSchema": { ... }
    }
  ]
}
```

## Manifest v2 Required Fields

| Field | Type | Description |
|---|---|---|
| `domain` | string | Internal identifier matching folder name |
| `shortName` | string | Short internal name (e.g. `"web-search"`) |
| `displayName` | string | UI-friendly name for Skills Library tab |
| `shortDescription` | string | One-line description shown on skill card |
| `iconUrl` | string (URL) | Blob storage URL for skill icon |
| `version` | string | Semver or RC tag |
| `deploymentScenario` | enum | `"personal-user-centric"` or `"enterprise-commercial"` |
| `onboardingMethod` | enum | `"automatic-agentic"`, `"post-install-link"`, or `"both"` |
| `lifecycleRules` | enum | `"keep-credentials"`, `"close-external-account"`, or `"ask-user"` |
| `tools` | array | Tool definitions (see below) |

## Manifest v2 Optional Fields

| Field | Type | Description |
|---|---|---|
| `linkConfig` | object | OAuth connection config (connectionName, displayName, description) |
| `dependencies` | string[] | Required skills (install blocked if missing) |
| `requiredPermissions` | string[] | Entra/Graph delegated permissions needed |
| `externalAccountsNeeded` | object[] | Third-party accounts required (structured entries with `description`, `envVarName?`, `satisfiedBy?`, `required?`) |
| `softOnboarding` | object | First-run personality prefs (preferredAddress, responseStyle) |
| `maintenanceTasks` | array | Scheduled/event-driven tasks (key rotation, credential refresh) |

## Tool-Level Key Fields

| Field | Values | Role |
|---|---|---|
| `risk` | `low \| medium \| high` | Drives human confirmation gate (0e) |
| `dataSensitivity` | `pii \| non-pii \| mixed` | Routes to correct LLM lane |
| `allowedModelLane` | `any \| global \| eu-only` | Enforces residency rules |
| `requiresConfirmation` | `true \| false` | Forces Adaptive Card even in `full-destructive` mode |
| `externalAutomationCapabilities` | array | Declares native automation hooks for durable hooks (0h) |
| `longTermMemorySchema` | array of vault field names | Declares skill-specific memory vaults (0i) |

## Onboarding Honesty Rules (#641, #649)

A discoverable skill must never show as "operational" when it silently fails at runtime. The assessor in `skillOperationalState.ts` classifies skills based on manifest truthfulness:

- `automatic-agentic` + all prerequisites satisfied → `operational`
- `automatic-agentic` + unsatisfied env vars or `requiredPermissions` → `operator-setup-required`
- `post-install-link` or `both` → `action-required`
- `operator/backend-config-required` → `operator-setup-required`
- `satisfiedBy: "oauth-link"` accounts are satisfied by user OAuth flow, not env vars — do not count as unsatisfied
- `satisfiedBy: "user-vault"` accounts require user to store the secret via the vault skill → classifies as `action-required` (recoverable), NOT `operator-setup-required`. Declare `dependencies: ["vault"]` in the manifest.

**Every `externalAccountsNeeded` entry MUST include `satisfiedBy`** so the assessor knows how to check satisfaction.

**User-vault pattern:** when a user-provided secret is needed, use `satisfiedBy: "user-vault"` + `kvSecretName: "PascalCaseName"` + `dependencies: ["vault"]`. Resolve in the handler: try `process.env[FALLBACK_VAR]` first (backward compat), then fetch from `USER_VAULT_KEY_VAULT_URI` via `@azure/keyvault-secrets` + managed identity. On failure, return a message directing the user to `vault_store_secret({ name: 'PascalCaseName', value: '<key>' })`. See `skills/x/manifest.json` + `skills/x/handlers.ts` as the canonical reference.

## SkillForge Landing Zone
- New AI-generated skills land in `skills/custom/`
- SkillForge output is treated as high-risk — full 0e pipeline applies before merge
- Hot-reload: capability loader rescans without restart after SkillForge merge
- `requiresConfirmation: true` must be set on all SkillForge-generated tools pending human review

## Special Circumstances Review (Ethos Check)
Every new skill must answer:
1. Does this respect the external system's native automation first? (`externalAutomationCapabilities`)
2. Does it declare what it needs to remember long-term? (`longTermMemorySchema`)
3. Is the risk level accurate — not under-stated?

## Always
- ✅ Declare all five key manifest fields for every tool
- ✅ Use `snake_case_with_domain` for all tool names (e.g. `github_list_issues`)
- ✅ Set `requiresConfirmation: true` on all SkillForge-generated tools until reviewed
- ✅ Declare native external automation capabilities — delegate to native first (0l ethos)
- ✅ Validate manifests with Zod schema, not just JSON parse

## Never
- ❌ Do NOT Ship a tool without a manifest — it will not be registered
- ❌ Do NOT Understate `risk` — when in doubt, go one level higher
- ❌ Do NOT Import between skill domains (no `skills/outlook/` importing from `skills/github/`)
- ❌ Do NOT Put tool implementation in `src/` — skill implementations belong in `skills/<domain>/tools/`
- ❌ Do NOT Allow SkillForge output to skip the 0e verification pipeline

*We are the bridge.*
