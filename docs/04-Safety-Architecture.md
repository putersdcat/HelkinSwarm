# HelkinSwarm Project Specification

## 4. Safety Architecture (Refined)

### Safety Philosophy

HelkinSwarm has powerful delegated access across Outlook, Teams, SharePoint, Entra ID, GitHub Enterprise, and Azure. Safety is **not** a prompt trick or afterthought — it is the architecture itself.

Even with global frontier models as the default (EU DataZoneStandard only when the toggle is enabled), no dangerous action can ever occur without multiple independent, layered safeguards stopping it.

The entire system is built as a **digital body** (see 0l): the master orchestrator is the skeptical brain that never blindly trusts any limb (skill, sub-agent, or SkillForge output).

### Safety Modes (Bicep-configured at deployment)

```bicep
param safetyMode string = 'confirmation-gated'   // read-only | confirmation-gated | full-destructive
```

| Mode                  | Behaviour                                                                 | Default |
|-----------------------|---------------------------------------------------------------------------|---------|
| `read-only`           | No write/delete tokens are ever minted. Destructive tools are no-op stubs. | —       |
| `confirmation-gated`  | All medium+ risk actions require explicit human confirmation via Adaptive Card. | **Yes** |
| `full-destructive`    | High-risk actions still require confirmation; low-risk writes auto-execute. | —       |

Safety mode is set once in Bicep and cannot be changed at runtime without redeploy. It applies universally — including to SkillForge and future Virtual Employees (0j).

### Risk Levels in Capability Manifests (0a)

Every tool in the modular `skills/` library declares:

```json
{
  "risk": "low | medium | high",
  "dataSensitivity": "pii | non-pii | mixed"
}
```

- **low** — list/read operations  
- **medium** — create/update/send  
- **high** — delete, admin actions, permission changes

### Full Safety & Four-Eyes Verification Pipeline

The mandatory, non-bypassable pipeline that sits between **every** sub-agent or SkillForge response and the orchestrator’s final decision is defined in detail in **0e-Safety-and-Four-Eyes-Verification-Pipeline.md**.

It enforces, in strict order:
1. Schema validation  
2. Data minimization  
3. Spot-check verification (the “second pair of eyes”)  
4. Prompt Shields (Azure Content Safety) for the Azure provider lane; direct OpenRouter mode currently bypasses this step as an explicit temporary tradeoff under `#501` / `0zb`  
5. Risk-tiered human confirmation via Adaptive Card

For the Azure provider lane, all steps are mandatory. For the current direct OpenRouter lane, the prompt-shields hop is intentionally bypassed and this tradeoff must be surfaced explicitly in runtime/docs/telemetry rather than hidden.

### Stamp-Local Policy Precedence

When stamp-local policy is present, confirmation behavior resolves in this order:

1. **Global safety mode** — `read-only` still blocks writes outright.
2. **Role / authority checks** — the caller must hold the authority required by the exception policy.
3. **Stamp-local policy** — explicit, auditable exceptions may relax confirmation for a specific tool on a specific stamp.
4. **Shared manifest defaults** — shared manifests remain the safe baseline and are no longer the system of record for personal stamp exceptions.

Fail-closed rule:
- malformed or unknown policy input never relaxes behavior
- missing authority never relaxes behavior
- absent policy falls back to global safety + manifest defaults

Migration rule:
- do **not** patch shared manifests for personal or stamp-local confirmation preferences
- move those exceptions into the stamp-policy layer and keep shared manifests aligned to the safe baseline

### Layered Defense-in-Depth

Safety is not a single checkpoint — it is enforced at **every layer** of the stack by heuristic code, never by prompt instructions:

| Layer | Mechanism | Location |
|-------|-----------|----------|
| **1. Prompt-time filtering** | `toolRegistry.getSafetyFiltered()` removes tools that violate the current safety mode before the LLM sees them. In read-only mode, only low-risk tools are presented. | `buildPromptActivity.ts`, `llmActivity.ts` |
| **2. Verification pipeline** | The 5-step 0e pipeline blocks medium/high risk in read-only, requires confirmation in gated mode. | `verificationPipeline.ts` |
| **3. Dispatch-time blocking** | `toolRegistry.isAllowedBySafetyMode()` rejects tool calls at execution time, even if the LLM fabricates a tool name not in the filtered set. | `toolDispatchActivity.ts`, `subAgentActivity.ts` |
| **4. Scoped token refusal** | `scopedTokenMinter.ts` refuses to mint write/delete tokens in read-only mode. | `scopedTokenMinter.ts` |
| **5. Executor isolation** | High-risk actions are handed off to a pure code executor that cannot reason or call the LLM. | `executorActivity.ts` |

### Scoped Tokens & Executor Agents

- **Scoped Token Minter** (`src/auth/scopedTokenMinter.ts`): Issues 5-minute delegated tokens with the **exact minimum privileges** needed for that tool call. Refuses write/delete tokens in read-only safety mode.
- **Executor Agents** (`src/orchestrator/executorActivity.ts`): High-risk actions are **never** executed by any LLM-bearing sub-agent. They are handed off to a pure code executor that cannot reason or call the LLM.

Delete-only tokens are never given to any LLM session.

### Human Confirmation Gate

Any medium or high-risk action triggers a clear Adaptive Card in the Teams chat with **Approve** / **Cancel** buttons and a 5-minute timeout.  
Button click raises a Durable external event back to the overseer.

### Emergency Stop

- `POST /api/emergency-stop` (protected endpoint)  
- Immediately sets maintenance mode, terminates all running orchestrators, and replies “I’m offline” to any new messages.  
- Reversible with `/emergency-resume` (owner only).

### Inheritance by SkillForge & Virtual Employees

- SkillForge output is treated as a special high-risk response and runs through the **full 0e pipeline**.  
- Future Virtual Employees (0j) inherit the exact same safety mode, scoped-token rules, and verification pipeline — no exceptions.

### What NOT to Do

- ❌ Never add a `bypassSafety`, `SKIP_VERIFICATION`, or `unsafeMode` flag anywhere.  
- ❌ Never route high-risk tools directly to the LLM.  
- ❌ Never issue long-lived tokens.  
- ❌ Never allow destructive actions without the human confirmation card and full 0e pipeline.  
- ❌ Never skip the verification pipeline — even for SkillForge or Virtual Employees.
