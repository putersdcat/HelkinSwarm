---
applyTo: "src/llm/**"
---

# LLM & Model Routing Rules
**Spec ref:** `docs/06-Tool-Dispatch-LLM-Layer.md`, `docs/0b-Model-Specific-Tool-Presentation-and-Self-Tuning-Eval-Loop.md`

## Critical Rule
**Never hard-code model names or endpoints.** All model selection flows through `src/llm/modelRouter.ts`. The `euResidencyMode` Bicep flag is the single switch that changes everything — no code changes required.

## Model Routing Logic

```typescript
// src/llm/modelRouter.ts — source of truth
const routing = {
  primary:   euResidencyMode ? "gpt-5"                    : "grok-4-1-fast-reasoning",
  secondary: euResidencyMode ? "o4-mini"                  : "grok-4-1-fast",
  embedding: euResidencyMode ? "text-embedding-3-large-eu": "text-embedding-3-large"
};
```

- **Default** (`euResidencyMode = false`): Best available global frontier models in Azure AI Foundry
- **EU mode** (`euResidencyMode = true`): DataZoneStandard models only — no data ever leaves the EU boundary
- The overseer uses the `primary` model; sub-agent tool calls use `secondary` by default

## Key Files

| File | Responsibility |
|------|----------------|
| `src/llm/modelRouter.ts` | Chooses model based on EU toggle + model profiles |
| `src/llm/foundryClient.ts` | API calls + parameter adaptation (global/EU/BYOK) |
| `src/llm/promptBuilder.ts` | Prompt assembly with skill memory + Hydra-Net |
| `src/tools/toolRegistry.ts` | Central registry of all tools (filtered by safety + model lane) |
| `src/orchestrator/toolDispatchActivity.ts` | Routes tool_calls to handlers |
| `src/orchestrator/subAgentActivity.ts` | Isolated sub-agent execution |

## Tool Dispatch Flow (Every Turn)
1. Capability Loader scans `skills/` and registers all tools
2. Tool Registry builds OpenAI-compatible schemas, applying active model-specific profile (0b)
3. Safety Filter removes tools violating current safety mode or model lane
4. Prompt Builder injects filtered tool list + skill memory + Hydra-Net if present
5. LLM returns `tool_calls`
6. `toolDispatchActivity.ts` routes each call to the correct handler
7. For high-risk operations: hand off to `executorActivity.ts` (non-LLM executor)
8. Full verification pipeline (0e) runs after execution

## Model Profiles (0b)
- Stored in `model-profiles/` — auto-generated and promoted by DevLoop
- Apply per-model tool aliasing and masking
- Never edit model profiles manually — DevLoop manages them via the self-tuning loop

## Always
- ✅ Route all model selection through `modelRouter.ts`
- ✅ Use `foundryClient.ts` as the single API abstraction layer
- ✅ Apply model-specific profiles when building the tool list for a request
- ✅ Use the secondary model for all sub-agent (tool execution) sessions
- ✅ Respect `allowedModelLane` in capability manifests (`any | global | eu-only`)

## Never
- ❌ Do NOT Hard-code model deployment names or Foundry endpoint URLs in code
- ❌ Do NOT Pass the full tool list to the LLM unfiltered — always apply safety + model lane filters
- ❌ Do NOT Allow the LLM sub-agent to call tools recursively
- ❌ Do NOT Bypass the safety pipeline or model-profile masking
- ❌ Do NOT Edit model profiles manually — they are DevLoop-managed artifacts

*We are the bridge.*
