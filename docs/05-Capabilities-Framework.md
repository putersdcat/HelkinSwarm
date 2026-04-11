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
│   ├── core/                  # Built-in always-present tools (helkin_*)
│   ├── azure/                 # Azure Cost Management (helkin_get_costs)
│   ├── azuremcp/              # Azure MCP bridge integration
│   ├── budget/                # Cost Estimation & Budgeting (#242)
│   ├── docformat/             # Markdown → DOCX conversion + OneDrive (#239)
│   ├── docs/                  # AI-native document storage + search (#244)
│   ├── entra/                 # Entra ID directory lookup (#243)
│   ├── github/                # GitHub Issues management (#121)
│   ├── graphenterprise/       # Microsoft Graph enterprise helpers
│   ├── hr/                    # HR & Owner Reporting (Azure costs + ledger) (#245)
│   ├── ledger/                # Lightweight bookkeeping ledger (#246)
│   ├── math/                  # Math specialist + expression evaluator (#434)
│   ├── mcpreference/          # MCP Registry search/discovery
│   ├── microsoftlearn/        # Microsoft Learn documentation search
│   ├── outlook/               # Email, calendar, OneDrive via Microsoft Graph
│   ├── research/              # Deep research via Brave Search + DuckDuckGo
│   ├── teams/                 # Teams reactions and channel interactions
│   ├── translate/             # Language translation via OpenRouter (#240)
│   ├── vault/                 # Key Vault secrets management (#178)
│   ├── weather/               # Weather forecasts
│   ├── web/                   # Web search (Brave Search + DuckDuckGo fallback)
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
| `modelAffinity` | No | object | Optional downstream hint for discovery-first follow-up model choice (`fast`, `reasoning`, `primary`) |
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
4. Rebuilds the manifest-derived skill discovery index used by the discovery-layer backlog work
5. Applies model-specific masks from active profiles (0b)

The discovery index is rebuilt from the currently loaded manifests on every successful capability load. That means:
- startup loads get a fresh index automatically
- `/reload skills` invalidates stale discovery data and rebuilds it from disk
- periodic hot-reload keeps the index aligned with SkillForge or manifest changes

If index generation fails, the loader now fails closed for that reload pass rather than keeping a silently stale discovery dataset alive.

The orchestrator now uses a **discovery-first tool presentation model**:
- the initial hop gets an intentionally small core tool surface
- `helkin_skill_search` is the bridge from that small surface into the wider skill library
- when discovery returns likely matches, the follow-up hop receives only the narrowed tool subset plus the core tools

### Downstream discovery contract

For post-discovery behavior, the current downstream contract is intentionally explicit:

- `recommendedEntryTools`
  - this is the **deterministic executable breadcrumb** used to build the narrowed follow-up tool subset
  - if discovery finds a skill but no executable tool subset is reached, the runtime must fail honestly rather than quietly pretending the request is complete
- `modelAffinity`
  - this is an **optional follow-up model hint**, not a top-level prompt-surface selector
  - when a discovery result resolves to a single consistent affinity across matched skills, the follow-up LLM hop uses:
    - `fast` → the secondary lane
    - `primary` or `reasoning` → the primary lane
  - if affinities conflict or are absent, no discovery-driven model override is applied
  - because the current follow-up router exposes primary/secondary slots rather than an arbitrary reasoning slot, `reasoning` currently coalesces to the primary slot

This means discovery metadata now materially affects downstream routing in two ways:
- executable tool narrowing via `recommendedEntryTools`
- follow-up model-slot steering via `modelAffinity` when the metadata is consistent enough to be deterministic

Historical design reference for this feature:
- `docs/skill-discovery-meta-tool-feature-concept-2026-03-28.md`

Implementation stack that materially delivered the feature:
- `#332`, `#333`, `#335`, `#336`, `#337`, `#338`

Important scope note:
- the delivered discovery layer covers manifest-driven indexing, `helkin_skill_search`, second-hop selective injection, the user-facing read-only `/skillSearch` chat command, and deterministic post-discovery use of `modelAffinity` for follow-up primary/secondary slot steering
- `/skillSearch` is a presentation layer over the same discovery index for human participants; it does **not** make discovered tools directly user-callable
- richer downstream use of discovery metadata beyond the current deterministic breadcrumbs remains future follow-on work rather than fully shipped behavior

This keeps safety filtering intact because the narrowed subset is still derived from the safety-filtered registry rather than bypassing it.

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

### Config-Gated Skill Rollout Standard

Skill authors are forbidden from exposing a skill for normal conversational use if the skill can still fail on a missing backend prerequisite that the user cannot satisfy from the current interaction.

This is a separate rollout concern from the manifest's `onboardingMethod` field.

#### Rollout Classification (operator-facing)

Use one of these classes when evaluating whether a skill is ready to be shown to normal users:

| Rollout class | Meaning | Exposure rule |
|---|---|---|
| `automatic-agentic` | The system can create/acquire/store everything it needs automatically | Safe to expose once the automation path is proven |
| `post-install-link` | The user must complete a supported `/link` or consent flow | Safe to expose only if the UX can detect missing linkage and guide recovery |
| `both` | Agentic backend setup plus a user completion/link step | Safe to expose only if both halves are wired and recoverable |
| `operator/backend-config-required` | Requires an API key, tenant config, billing setup, allow-list, or other backend/operator step not solvable from the current user turn | **Do not expose as ready for normal use** until preflight checks and graceful fallback exist |

The first three values are current manifest-backed onboarding modes. The fourth is an operational rollout classification that must be applied during design and release review even if the manifest schema has not yet been extended to encode it directly.

For runtime/UI honesty, the product-facing skill state should be expressed separately from the rollout class. At minimum, a surfaced skill should be distinguishable as:

- `operational`
- `action-required`
- `operator-setup-required`
- `blocked`

This prevents the UI from collapsing "manifest exists" into "fully usable right now." A skill can be installed and still be non-operational until link, tenant, permission, or backend prerequisites are genuinely satisfied.

#### Mandatory preflight readiness checks

Before a config-gated skill is treated as available to the orchestrator, the rollout must prove all of the following:

1. **Credential/config presence** — required API key, connection, tenant setting, or external account exists
2. **Credential/config validity** — a cheap test call or validation probe succeeds
3. **Recovery path exists** — the system knows what to do when the prerequisite is absent or stale
4. **User-facing response is humane** — no vague backend-only shrug reaches the chat participant
5. **Discovery honesty** — a not-ready skill is either hidden from normal routing or surfaced as not-yet-configured rather than silently failing at invocation time

If any of those checks are false, the skill is not rollout-ready.

#### Graceful fallback requirements

When a best-match skill is installed but not yet configured, the orchestrator must do one of the following instead of surfacing a raw backend failure:

- route to a lower-fidelity but working alternative
- explain clearly that the capability exists but is not yet configured on this stamp
- guide the supported setup path (`/link`, operator action, or control-center workflow)
- decline honestly and create/point to the correct follow-up work item if the capability cannot yet be enabled safely

What must **not** happen:

- a vague `missing key`, `not configured`, or backend stack-style error dumped into chat
- pretending the skill is ready because the manifest exists
- exposing a voice or chat invocation path that dead-ends in operator-only backend instructions

#### Anti-pattern example: `skills/web/`

The current web-search skill is the canonical failure mode to avoid:

- `skills/web/manifest.json` declares `onboardingMethod: "automatic-agentic"`
- the same manifest also declares an external requirement: `Brave Search API key`
- `skills/web/handlers.ts` throws when `BRAVE_SEARCH_API_KEY` is absent:
  - `Web search not configured — BRAVE_SEARCH_API_KEY not set...`

That means a normal user can ask for web search and still hit a backend-configuration failure if the operator path was never completed.

This is exactly the UX trap future skills must not repeat.

#### Checklist for future skill rollouts

Before merging or exposing a new skill, confirm:

- [ ] onboarding mode is declared honestly
- [ ] rollout class is evaluated explicitly, including `operator/backend-config-required` when applicable
- [ ] required permissions, external accounts, and backend prerequisites are listed
- [ ] a preflight readiness check exists
- [ ] graceful fallback text/behavior exists for not-yet-configured states
- [ ] the orchestrator will not route ordinary users into backend-only setup failures

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
| `helkin_current_datetime` | low | Returns current UTC datetime and timezone information |
| `helkin_recent_requests` | low | Returns the most recent turns processed by the orchestrator for context continuity |
| `helkin_skill_search` | low | Discovery-only skill/tool browser with `help`, `search`, `describe_skill`, `describe_tool`, and `list_domains` for narrowing the capability surface before execution |
| `helkin_mcp_registry_search` | low | Searches a synced local cache of official MCP Registry candidates with `help`, `search`, `status`, and `refresh`, keeping external candidates distinct from installed HelkinSwarm skills |
| `helkin_mcp_forge` | medium | Drafts, inspects, and locally approves McpForge onboarding bundles for discovered MCP Registry candidates after MCP smoke-test validation |
| `helkin_get_costs` | low | Queries Azure Cost Management for real MTD spend in the stamp resource group (#232) |
| `helkin_test_confirmation` | medium | Sends a test Adaptive Card confirmation to verify the verification pipeline end-to-end |
| `helkin_save_preferences` | low | Persists user preferences to Cosmos DB skill vault |
| `helkin_forget_skill` | medium | Revokes credentials and removes a skill vault; enforces lifecycle rules (`close-external-account` blocks without explicit override) (#199) |
| `helkin_skill_catalog` | low | Lists all skill vaults with entry counts, lifecycle rules, maintenance tasks, and external accounts (#199) |
| `helkin_install_skill` | low | Checks installation readiness for a skill; resolves dependencies and returns step-by-step onboarding guide (#200) |
| `helkin_uninstall_skill` | medium | Checks if a skill can be safely uninstalled; blocks if any installed skill depends on it (bidirectional dependency check) (#200) |
| `helkin_whoami` | low | Returns the current user's role (`owner`/`user`/`guest`) and permissions in HelkinSwarm (#248) |

The MCP tools above are explicit management/discovery surfaces that are already wired today via `skills/core/handlers.ts`.

Important scope note:
- their existence does **not** mean the orchestrator already performs an automatic fallback from local installed-skill discovery into MCP Registry candidate search
- current verified MCP Registry entry points are the explicit core tools and the owner-facing Skills Library registry UI
- follow-on automatic fallback and update-tracking work is tracked in `docs/0u-MCP-Forge-Lightweight-Skill-Integration-and-Automatic-Update-Mechanism.md`, `#481`, and `#482`

### Application-Level RBAC (`src/auth/roles.ts`)

Added in #248. Three roles are defined:

| Role | Permissions | Assigned by |
|------|-------------|-------------|
| `owner` | all, control-center, maintenance, high-risk | OWNER_USER_ID env var match |
| `user` | standard, read, skill-invoke | All other authenticated users |
| `guest` | read-only | Future: unauthenticated or anonymous callers |

Role resolution flows through `getUserRole(userId)` → `canInvokeTool(role, toolName)` in `toolDispatchActivity.ts`. Currently owner-restricted tools: `helkin_test_confirmation`.

The `OWNER_USER_ID` environment variable must be set on the Function App (e.g. `40f5c975-3aa2-47d8-b32d-a9d7a392f6dc` for eric@putersdcat.com).

### Current Live Skills Inventory (as of 2026-04-11)

22 skill domains are loaded at runtime on the `a7f2` stamp.

| Domain | Key Tools | Auth | Status |
|--------|-----------|------|--------|
| `core` | `helkin_*` (health, whoami, skill_search, get_costs, …) | UAMI | Always-on |
| `azure` | Budget/cost fetching | UAMI | Operational |
| `azuremcp` | Azure MCP bridge | UAMI | Operational |
| `budget` | `budget_estimate_cost`, `budget_compare_options` | UAMI | Operational |
| `docformat` | `docformat_save_docx` | GraphOAuth (OneDrive) | Requires `/link` |
| `docs` | `docs_save`, `docs_get`, `docs_list`, `docs_search` | UAMI (Cosmos) | Operational |
| `entra` | `entra_get_my_profile`, `entra_find_people` | GraphOAuth | Requires `/link` (People.Read) |
| `github` | `github_list_issues`, `github_push_files`, … | GitHub App token | Operational |
| `graphenterprise` | Enterprise Graph helpers | UAMI | Operational |
| `hr` | `hr_generate_owner_report` | UAMI + GraphOAuth | Operational |
| `ledger` | `ledger_record_entry`, `ledger_query` | UAMI (Cosmos) | Operational |
| `math` | `math_evaluate`, `math_solve`, `math_unit_convert` | None | Operational |
| `mcpreference` | `helkin_mcp_registry_search`, `helkin_mcp_forge` | None | Operational |
| `microsoftlearn` | `microsoftlearn_search` | None | Operational |
| `outlook` | `outlook_list_emails`, `outlook_send_email`, calendar, OneDrive | GraphOAuth | Requires `/link` |
| `research` | `deep_research` | Brave API key | Operational (DuckDuckGo fallback) |
| `teams` | `teams_add_reaction`, `teams_get_message` | GraphOAuth | Requires `/link` |
| `translate` | `translate_text` | OpenRouter | Operational |
| `vault` | `vault_get_secret`, `vault_set_secret`, `vault_list` | UAMI | Operational (owner-restricted) |
| `weather` | `weather_get_current`, `weather_get_forecast` | OpenWeather API | Operational |
| `web` | `web_search` | Brave API key | Operational (DuckDuckGo fallback) |
| `custom` | User-defined | Varies | Hot-reloadable |

_Note: "Requires `/link`" means the skill uses a delegated OAuth token from `GraphOAuth` Bot Service connection. User must type `/link <skill>` to consent._


