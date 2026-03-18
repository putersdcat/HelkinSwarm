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

## Key Fields

| Field | Values | Role |
|---|---|---|
| `risk` | `low \| medium \| high` | Drives human confirmation gate (0e) |
| `dataSensitivity` | `pii \| non-pii \| mixed` | Routes to correct LLM lane |
| `allowedModelLane` | `any \| global \| eu-only` | Enforces residency rules |
| `requiresConfirmation` | `true \| false` | Forces Adaptive Card even in `full-destructive` mode |
| `externalAutomationCapabilities` | array | Declares native automation hooks for durable hooks (0h) |
| `longTermMemorySchema` | array of vault field names | Declares skill-specific memory vaults (0i) |

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
- ❌ Ship a tool without a manifest — it will not be registered
- ❌ Understate `risk` — when in doubt, go one level higher
- ❌ Import between skill domains (no `skills/outlook/` importing from `skills/github/`)
- ❌ Put tool implementation in `src/` — skill implementations belong in `skills/<domain>/tools/`
- ❌ Allow SkillForge output to skip the 0e verification pipeline

*We are the bridge.*
