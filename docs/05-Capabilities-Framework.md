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

### Capability Manifest Format (v1)

Every manifest follows this exact schema (validated by Zod at load time):

```json
{
  "domain": "outlook",
  "version": "1.0",
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

### Key Fields Explained

| Field                        | Values                          | Role |
|------------------------------|---------------------------------|------|
| `risk`                       | low / medium / high             | Drives human confirmation (0e) |
| `dataSensitivity`            | pii / non-pii / mixed           | Routes to correct LLM lane |
| `allowedModelLane`           | any / global / eu-only          | Enforces residency rules |
| `requiresConfirmation`       | true / false                    | Forces Adaptive Card even in full-destructive mode |
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

The LLM only ever sees the **safe, filtered subset** that the current safety mode, model lane, and active profile allow.

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
