# HelkinSwarm Project Specification

## 5. Capabilities Framework (Refined)

### Why a Declarative Framework?

Instead of hard-coding tools inside LLM prompts or function-calling logic, every capability in HelkinSwarm is defined in clean, version-controlled JSON manifests stored in the modular `skills/` library (see **0a-Modularity-and-Config.md**).

This gives us:
- Full Git history and auditability
- Automatic safety classification and routing
- Easy addition or swapping of skills without touching core code
- Foundation for SkillForge (dynamic skill creation)
- Clear separation between “what the tool can do” and “how the LLM sees it”

The capabilities system is the **contract** between the core runtime and the swappable skills library — making HelkinSwarm truly modular and future-proof.

### Location & Structure (Modular Skills Library)

```
HelkinSwarm/
├── skills/                    # Top-level modular skills library (see 0a)
│   ├── core/                  # Built-in always-present tools
│   ├── outlook/
│   ├── teams/
│   ├── github/
│   ├── azure/
│   └── custom/                # User/private skills (hot-reloadable)
├── src/capabilities/          # Capability loader + schema (core only)
```

Skills are discovered automatically at startup. Each folder contains its own `manifest.json` plus implementation files.

### Capability Manifest Format (v2)

Every manifest follows this schema, validated by Zod at load time (`src/capabilities/manifestSchema.ts`):

```json
{
  "domain": "outlook",
  "version": "1.0",
  "shortName": "outlook",
  "displayName": "Outlook",
  "shortDescription": "Email and calendar management via Microsoft Graph",
  "iconUrl": "https://helkinswarmtabsst.z20.web.core.windows.net/icons/outlook.png",
  "deploymentScenario": "personal-user-centric",
  "onboardingMethod": "post-install-link",
  "lifecycleRules": "keep-credentials",
  "requiredPermissions": ["User.Read", "Mail.Read", "Mail.Send"],
  "tools": [
    {
      "name": "outlook_list_emails",
      "description": "List emails in a mailbox with optional filters",
      "risk": "low",
      "dataSensitivity": "pii",
      "allowedModelLane": "any",
      "requiresConfirmation": false,
      "requiresExecutor": false,
      "requiresSubAgent": false,
      "externalAutomationCapabilities": [
        { "type": "exchangeRule", "action": "createRule" }
      ],
      "longTermMemorySchema": ["blockList"],
      "inputSchema": { ... },
      "outputSchema": { ... }
    }
  ],
  "linkConfig": {
    "connectionName": "OutlookOAuth",
    "displayName": "Microsoft Outlook",
    "description": "Connect your Microsoft account for email and calendar"
  }
}
```

### Top-Level Manifest Fields

| Field | Required | Type | Role |
|-------|----------|------|------|
| `domain` | Yes | string | Internal identifier, matches folder name |
| `version` | Yes | string | Manifest version (`"1.0"`, `"RC-2026-03"`) |
| `shortName` | Yes | string | Short identifier for dependency references |
| `displayName` | Yes | string | UI-friendly name for Skills Library tab |
| `shortDescription` | Yes | string | One-line description shown on skill card |
| `iconUrl` | Yes | URL | Blob storage icon for Skills Library tab |
| `deploymentScenario` | Yes | enum | `personal-user-centric` or `enterprise-commercial` |
| `onboardingMethod` | Yes | enum | `automatic-agentic`, `post-install-link`, or `both` |
| `lifecycleRules` | Yes | enum | `keep-credentials`, `close-external-account`, or `ask-user` |
| `tools` | Yes | array | Tool definitions (see below) |
| `linkConfig` | No | object | SSO connection config for OAuth-based skills |
| `dependencies` | No | string[] | Required skill shortNames (install blocked if missing) |
| `requiredPermissions` | No | string[] | Entra/Graph delegated permissions needed |
| `externalAccountsNeeded` | No | string[] | Third-party accounts required |
| `softOnboarding` | No | object | First-run personality preferences |
| `maintenanceTasks` | No | array | Scheduled/event-driven maintenance tasks |

### Tool-Level Fields

| Field                        | Values                          | Role |
|------------------------------|---------------------------------|------|
| `risk`                       | low / medium / high             | Drives human confirmation (0e) and safety-mode filtering |
| `dataSensitivity`            | pii / non-pii / mixed           | Routes to correct LLM lane |
| `allowedModelLane`           | any / global / eu-only          | Enforces residency rules |
| `requiresConfirmation`       | true / false                    | Forces Adaptive Card even in full-destructive mode |
| `requiresExecutor`           | true / false                    | Routes through executor pipeline (no LLM, direct execution) |
| `requiresSubAgent`           | true / false                    | Routes through isolated sub-agent LLM session |
| `externalAutomationCapabilities` | array of native features     | Enables durable hooks & delegation (0h) |
| `longTermMemorySchema`       | array of vault fields           | Declares skill-specific memory (0i) |

### Capability Loader (`src/capabilities/capabilityLoader.ts`)

At startup (and on hot-reload after SkillForge merge):
1. Scans all `skills/*/manifest.json` files
2. Validates them against the central schema
3. Registers every tool in the Tool Registry
4. Applies model-specific masks from active profiles (0b)

### Central Tool Registry

Location: `src/tools/toolRegistry.ts`

All tools (JSON + MCP + custom) are registered here with:
- OpenAI-compatible function schema for the LLM
- Handler function reference
- Risk, safety metadata, and memory schema

Key methods:
- `getSafetyFiltered()` — returns tools allowed by current safety mode (read-only → low risk only; confirmation-gated/full-destructive → all tools)
- `toFunctionSchemas()` — converts safety-filtered tools to OpenAI function schemas for LLM presentation
- `getUpToRisk(maxRisk)` — returns tools up to a given risk ceiling
- `isAllowedBySafetyMode(toolName)` — runtime check used by dispatch activities for defense-in-depth

The LLM only ever sees the **safe, filtered subset** that the current safety mode, model lane, and active profile allow. This filtering happens at two independent layers:
1. **Prompt-time** — `getSafetyFiltered()` removes tools before they're shown to the LLM
2. **Dispatch-time** — `isAllowedBySafetyMode()` rejects tool calls at execution time (defense-in-depth)

### Integration with Safety Pipeline (0e)

Every tool call automatically flows through the full four-eyes verification pipeline:
- Schema validation
- Data minimization
- Spot-check verification
- Prompt Shields
- Risk-tiered human confirmation

No tool author has to remember any of these steps — they are enforced by the registry.

### SkillForge Connection (0f)

When SkillForge creates a new skill:
- It generates a complete manifest + code
- Opens a PR with the new folder under `skills/`
- On merge → capability loader picks it up instantly (hot-reload)

### What NOT to Do

- ❌ Never add tools directly in code without a matching manifest in the skills library
- ❌ Never hard-code risk levels, schemas, or memory fields in TypeScript
- ❌ Never bypass the capability loader or Tool Registry
- ❌ Never create a skill without declaring `externalAutomationCapabilities` and `longTermMemorySchema`

### Core Skill Tool Inventory (`skills/core/`)

The `core` skill is always present and cannot be uninstalled. It provides HelkinSwarm's self-management tools.

| Tool | Risk | Description |
|------|------|-------------|
| `helkin_health_check` | low | Returns bot version, runtime health, and component status |
| `helkin_list_skills` | low | Lists all loaded skill manifests and their domains |
| `helkin_get_costs` | low | Queries Azure Cost Management for real MTD spend in the stamp resource group (#232) |
| `helkin_test_confirmation` | medium | Sends a test Adaptive Card confirmation to verify the verification pipeline end-to-end |
| `helkin_save_preferences` | low | Persists user preferences to Cosmos DB skill vault |
| `helkin_forget_skill` | medium | Revokes credentials and removes a skill vault; enforces lifecycle rules (`close-external-account` blocks without explicit override) (#199) |
| `helkin_skill_catalog` | low | Lists all skill vaults with entry counts, lifecycle rules, maintenance tasks, and external accounts (#199) |
| `helkin_install_skill` | low | Checks installation readiness for a skill; resolves dependencies and returns step-by-step onboarding guide (#200) |
| `helkin_uninstall_skill` | medium | Checks if a skill can be safely uninstalled; blocks if any installed skill depends on it (bidirectional dependency check) (#200) |
| `helkin_whoami` | low | Returns the current user's role (`owner`/`user`/`guest`) and permissions in HelkinSwarm (#248) |

### Application-Level RBAC (`src/auth/roles.ts`)

Added in #248. Three roles are defined:

| Role | Permissions | Assigned by |
|------|-------------|-------------|
| `owner` | all, control-center, maintenance, high-risk | OWNER_USER_ID env var match |
| `user` | standard, read, skill-invoke | All other authenticated users |
| `guest` | read-only | Future: unauthenticated or anonymous callers |

Role resolution flows through `getUserRole(userId)` → `canInvokeTool(role, toolName)` in `toolDispatchActivity.ts`. Currently owner-restricted tools: `helkin_test_confirmation`.

The `OWNER_USER_ID` environment variable must be set on the Function App (e.g. `40f5c975-3aa2-47d8-b32d-a9d7a392f6dc` for eric@putersdcat.com).

