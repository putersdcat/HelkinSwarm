------














































































*We are the bridge.*- ❌ Allow SkillForge output to bypass the 0e verification pipeline- ❌ Skip the confirmation gate for `safetyMode = full-destructive` on high-risk actions- ❌ Mint broad or long-lived tokens for tool calls- ❌ Allow the LLM to execute destructive actions directly — always via executor agent- ❌ Add `bypassSafety`, `SKIP_VERIFICATION`, `unsafeMode`, or any equivalent flag## Never- ✅ Mint scoped 5-minute tokens via `scopedTokenMinter.ts` for every tool execution- ✅ Use `executorActivity.ts` for high-risk operations — never an LLM-bearing session- ✅ Run the full 0e pipeline after every sub-agent or SkillForge response- ✅ Declare `risk` and `dataSensitivity` in every tool's capability manifest## Always- Virtual Employees (future) inherit the exact same safety mode and verification pipeline — no exceptions- SkillForge output is treated as a **high-risk response** — runs through the full 0e pipeline## SkillForge & Virtual Employees (0f, 0j)- Reversible with `/emergency-resume` (owner only)- Immediately sets maintenance mode, terminates all running orchestrators- `POST /api/emergency-stop` (protected, owner-only)## Emergency Stop- Delete-only tokens are never given to any LLM session- `src/orchestrator/executorActivity.ts`: High-risk actions handed to a **pure code executor** that cannot call the LLM or reason about context- `src/auth/scopedTokenMinter.ts`: 5-minute tokens with exact minimum privileges## Scoped Tokens + Executor Agents**Failure at any step aborts the turn and notifies the user.** No exceptions.5. Risk-tiered human confirmation (Adaptive Card for medium/high)4. Prompt Shields (Azure Content Safety)3. Spot-check verification — secondary LLM re-reads and validates the action2. Data minimization — strips unnecessary PII from response1. Schema validation — output matches declared output schemaEvery sub-agent and SkillForge response passes through this pipeline **in strict order** before the orchestrator acts:## Mandatory Four-Eyes Verification Pipeline (0e)| `high` | Delete, admin actions, permission changes | Always (in all modes) || `medium` | Create, update, send operations | Yes (in `confirmation-gated` mode) || `low` | List, read, search operations | No ||---|---|---|| Risk | Examples | Confirmation Required |```}  "dataSensitivity": "pii | non-pii | mixed"  "risk": "low | medium | high",{```json## Risk Levels (Declared in Capability Manifests)The safety mode is set once in Bicep and applies universally — including SkillForge and future Virtual Employees.| `full-destructive` | High-risk actions still require confirmation; low-risk writes auto-execute. || `confirmation-gated` | All medium+ risk actions require explicit human confirmation via Adaptive Card. **Default.** || `read-only` | No write/delete tokens ever minted. Destructive tools are no-op stubs. ||---|---|| Mode | Behaviour |```param safetyMode string = 'confirmation-gated'  // read-only | confirmation-gated | full-destructive```bicep## Safety Modes (Bicep-controlled — cannot be changed at runtime)Safety is **non-bypassable architecture**, not a prompt trick. There is no `bypassSafety`, `SKIP_VERIFICATION`, `unsafeMode`, or any equivalent flag anywhere in the codebase. Violating this is a critical security defect.## Critical Rule**Spec ref:** `docs/04-Safety-Architecture.md`, `docs/0e-Safety-and-Four-Eyes-Verification-Pipeline.md`# Safety Architecture Rules---applyTo: "**"applyTo: "**"
---

# Safety Architecture Rules
**Spec ref:** `docs/04-Safety-Architecture.md`, `docs/0e-Safety-and-Four-Eyes-Verification-Pipeline.md`

## Critical Rule
Safety is **non-bypassable architecture**, not a prompt trick. There is no `bypassSafety`, `SKIP_VERIFICATION`, `unsafeMode`, or any equivalent flag anywhere in the codebase. Violating this is a critical security defect.

## Safety Modes (Bicep-controlled — cannot be changed at runtime)

```bicep
param safetyMode string = 'confirmation-gated'  // read-only | confirmation-gated | full-destructive
```

| Mode | Behaviour |
|---|---|
| `read-only` | No write/delete tokens ever minted. Destructive tools are no-op stubs. |
| `confirmation-gated` | All medium+ risk actions require explicit human confirmation via Adaptive Card. **Default.** |
| `full-destructive` | High-risk actions still require confirmation; low-risk writes auto-execute. |

The safety mode is set once in Bicep and applies universally — including SkillForge and future Virtual Employees.

## Risk Levels (Declared in Capability Manifests)

```json
{
  "risk": "low | medium | high",
  "dataSensitivity": "pii | non-pii | mixed"
}
```

| Risk | Examples | Confirmation Required |
|---|---|---|
| `low` | List, read, search operations | No |
| `medium` | Create, update, send operations | Yes (in `confirmation-gated` mode) |
| `high` | Delete, admin actions, permission changes | Always (in all modes) |

## Mandatory Four-Eyes Verification Pipeline (0e)
Every sub-agent and SkillForge response passes through this pipeline **in strict order** before the orchestrator acts:

1. Schema validation — output matches declared output schema
2. Data minimization — strips unnecessary PII from response
3. Spot-check verification — secondary LLM re-reads and validates the action
4. Prompt Shields (Azure Content Safety)
5. Risk-tiered human confirmation (Adaptive Card for medium/high)

**Failure at any step aborts the turn and notifies the user.** No exceptions.

## Scoped Tokens + Executor Agents
- `src/auth/scopedTokenMinter.ts`: 5-minute tokens with exact minimum privileges
- `src/orchestrator/executorActivity.ts`: High-risk actions handed to a **pure code executor** that cannot call the LLM or reason about context
- Delete-only tokens are never given to any LLM session

## Emergency Stop
- `POST /api/emergency-stop` (protected, owner-only)
- Immediately sets maintenance mode, terminates all running orchestrators
- Reversible with `/emergency-resume` (owner only)

## SkillForge & Virtual Employees (0f, 0j)
- SkillForge output is treated as a **high-risk response** — runs through the full 0e pipeline
- Virtual Employees (future) inherit the exact same safety mode and verification pipeline — no exceptions

## Always
- ✅ Declare `risk` and `dataSensitivity` in every tool's capability manifest
- ✅ Run the full 0e pipeline after every sub-agent or SkillForge response
- ✅ Use `executorActivity.ts` for high-risk operations — never an LLM-bearing session
- ✅ Mint scoped 5-minute tokens via `scopedTokenMinter.ts` for every tool execution

## Never
- ❌ Add `bypassSafety`, `SKIP_VERIFICATION`, `unsafeMode`, or any equivalent flag
- ❌ Allow the LLM to execute destructive actions directly — always via executor agent
- ❌ Mint broad or long-lived tokens for tool calls
- ❌ Skip the confirmation gate for `safetyMode = full-destructive` on high-risk actions
- ❌ Allow SkillForge output to bypass the 0e verification pipeline

*We are the bridge.*
