---
applyTo: "skills/**,src/capabilities/**"
---

# Skills Library Standards
**Spec ref:** `docs/skills-system-enhancement-2026-03-24v2.md`, `docs/05-Capabilities-Framework.md`

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
| `externalAccountsNeeded` | string[] | Third-party accounts required |
| `softOnboarding` | object | First-run personality prefs (address style, response length) |
| `maintenanceTasks` | array | Scheduled/event-driven tasks (key rotation, credential refresh) |

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
| `requiresSubAgent` | no | Boolean — if true, runs in isolated LLM session |
| `requiresExecutor` | no | Boolean — if true, goes through executor pipeline |

## Onboarding Requirements

- Every skill must declare `onboardingMethod` in its manifest
- `"automatic-agentic"` — orchestrator handles all setup (create accounts, store keys)
- `"post-install-link"` — user completes OAuth / external setup via `/link`
- `"both"` — agentic setup + user confirmation step
- No user-facing "missing config" errors allowed — trap and resolve in orchestrator

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

## Never
- ❌ Do NOT ship a skill without a manifest
- ❌ Do NOT use `any` in tool inputSchema — be explicit
- ❌ Do NOT hard-code API keys — use Key Vault via managed identity
- ❌ Do NOT import between skill domains (`skills/outlook/` cannot import from `skills/github/`)
- ❌ Do NOT allow silent failures on missing credentials — surface actionable errors
