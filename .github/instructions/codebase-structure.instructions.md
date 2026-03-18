---
applyTo: "**"
---

# Codebase Structure Rules
**Spec ref:** `docs/15-Project-Structure.md`, `docs/0a-Modularity-and-Config.md`

## Critical Rule
`src/` is the core runtime. `skills/` is the modular skills library. **Never cross the boundary** — core code must not import from `skills/`, and skills must not import from other skills.

## Repository Layout

```
src/
├── auth/          # Identity, scoped token minter, OBO provider
├── bot/           # Teams adapter, activity handler, confirmation cards
├── capabilities/  # Capability loader + schema validation (core only)
├── config/        # Safety config, env validation
├── functions/     # Azure Functions triggers (HTTP, Durable, Timer)
├── integrations/  # Shared integration helpers
├── llm/           # Foundry client, model router, prompt builder
├── memory/        # Cosmos DB + DiskANN vector layer
├── mcp/           # MCP bridge + Teams Test Harness
├── orchestrator/  # Eternal overseer + all Durable activities
├── persona/       # Drone persona + operator priors
├── tools/         # Core tool implementations
└── observability/ # Telemetry, correlation IDs, health
skills/
├── core/          # Built-in always-present tools
├── outlook/ teams/ github/ azure/
└── custom/        # User/private skills — SkillForge landing zone
```

## Naming Conventions (Strict)

| Item | Convention | Example |
|------|------------|---------|
| Activity functions | `<purpose>Activity.ts` | `sendReplyActivity.ts` |
| Orchestrators | `<purpose>Orchestrator.ts` | `sessionOrchestrator.ts` |
| Tool files | `<verb><Domain>.ts` | `listEmails.ts` |
| Capability manifests | `<domain>.json` | `outlook.json` |
| Config files | `<thing>Config.ts` | `safetyConfig.ts` |
| Env variables | `UPPER_SNAKE_CASE` | `EU_RESIDENCY_MODE` |
| Tool names in registry | `snake_case_with_domain` | `outlook_list_emails` |
| Skill folders | lowercase | `skills/outlook/` |

## TypeScript Rules (All Enforced by tsconfig + ESLint)

- `"strict": true` — no exceptions
- `"module": "NodeNext"` — all imports use `.js` extension in source
- **Zod** for every external input, config, tool schema, and capability manifest
- No `any` types
- No barrel files that re-export everything (`index.ts` re-exports only)
- Named exports only — no default exports
- ESLint 9 flat config with `@typescript-eslint/recommended`

## Always
- ✅ Place new tools in the correct `skills/<domain>/` folder, not in `src/tools/`
- ✅ Validate all external data shapes at the boundary with Zod
- ✅ Use `.js` extensions in all imports (NodeNext requirement)
- ✅ Commit with issue reference: `feat(#NNN):`, `fix(#NNN):`

## Never
- ❌ Do NOT Import from `skills/` inside `src/` (core cannot depend on skills)
- ❌ Do NOT Import between skill domains (`skills/outlook/` must not import from `skills/github/`)
- ❌ Do NOT Use `any` type or bypass TypeScript strict mode
- ❌ Do NOT Add barrel/index files that re-export an entire directory
- ❌ Do NOT Hard-code environment-specific values in code — use env vars + config

*We are the bridge.*
