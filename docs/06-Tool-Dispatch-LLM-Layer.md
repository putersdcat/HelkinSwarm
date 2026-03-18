# HelkinSwarm Project Specification

## 6. Tool Dispatch & LLM Layer (Refined)

### Overview

The LLM Layer is the **reasoning engine** of HelkinSwarm. It is deliberately architected for **maximum performance by default** (global frontier models) while remaining fully compatible with EU DataZoneStandard residency when the toggle is enabled.

Tool dispatch is handled through a clean, declarative registry that guarantees every call passes through the safety pipeline (0e), model-specific presentation rules (0b), and just-in-time memory injection (0i) before execution.

### Model Routing Logic (Unchained Default)

```typescript
// src/llm/modelRouter.ts
const routing = {
  primary:   euResidencyMode ? "gpt-5" : "grok-4-1-fast-reasoning",
  secondary: euResidencyMode ? "o4-mini" : "grok-4-1-fast",
  embedding: euResidencyMode ? "text-embedding-3-large-eu" : "text-embedding-3-large"
};
```

- **Default mode** (`euResidencyMode = false`): Uses the absolute best global frontier models available in Azure AI Foundry.
- **EU mode** (`euResidencyMode = true`): Automatically switches to DataZoneStandard models only.
- The toggle is set once in Bicep (see 03) and propagated everywhere — no code changes needed.

### LLM Client Abstraction

`src/llm/foundryClient.ts` provides a single, provider-agnostic interface that automatically adapts parameters for reasoning vs standard models and routes external BYOK calls (0c) through Azure Content Safety when configured.

### Tool Dispatch Flow

1. **Capability Loader** scans the modular `skills/` library (0a) at startup and on hot-reload.  
2. **Tool Registry** builds OpenAI-compatible function schemas, applying the active **model-specific profile** (0b).  
3. **Safety Filter** removes any tool that violates the current safety mode or model lane.  
4. **Prompt Builder** injects the filtered, masked tool list + just-in-time skill memory (0i) + Hydra-Net embeddings if present (0k).  
5. **LLM returns tool_calls**.  
6. **Tool Dispatch Activity** routes each call to the correct handler.  
7. **Executor Agent** takes over for high-risk operations (the LLM itself never executes destructive actions).  
8. **Full Verification Pipeline** (0e) runs after execution.

### Sub-Agent Isolation

Every tool call runs in a **fresh, isolated LLM session** (`subAgentActivity.ts`):
- No shared conversation history with the main overseer.
- Uses the secondary (faster) model by default.
- Receives only the minimal context needed for that specific tool.
- Cannot call other tools recursively.

This prevents prompt injection bleed and keeps context windows small.

### Integration with Self-Improvement (0g + 0b)

The bidirectional DevLoop channel allows the VS Code agent to:
- Interrogate the live runtime (“what tools do you currently see?”).
- Run controlled benchmarks across all models.
- Auto-generate and promote winning model profiles (0b).

This closed loop is the mechanism that keeps tool presentation optimal as new global or EU models become available.

### Key Files

| File | Responsibility |
|------|----------------|
| `src/llm/modelRouter.ts` | Decides which model to use based on EU toggle |
| `src/llm/foundryClient.ts` | Actual API calls + parameter adaptation (global/EU/BYOK) |
| `src/llm/promptBuilder.ts` | Main prompt assembly with skill memory + Hydra-Net |
| `src/tools/toolRegistry.ts` | Central registry of all tools |
| `src/orchestrator/toolDispatchActivity.ts` | Routes tool_calls to handlers |
| `src/orchestrator/subAgentActivity.ts` | Isolated sub-agent execution |

### What NOT to Do

- ❌ Never hard-code model names or endpoints in code — always go through the router.
- ❌ Never allow the LLM to see unfiltered tools.
- ❌ Never bypass the safety pipeline or model-profile masking.
- ❌ Never treat tool dispatch as a simple function call — it is a full safety-gated activity.
