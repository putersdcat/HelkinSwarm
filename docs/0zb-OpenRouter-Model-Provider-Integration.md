# HelkinSwarm Project Specification

## 0zb. OpenRouter Model Provider Integration (Refined)

**Spec ref:** `docs/0z-Living-Mind-Architecture-Temporal-Consciousness-and-Single-Session-Orchestration.md`, `src/llm/modelRouter.ts`, `src/llm/foundryClient.ts`

**Status:** High-priority infrastructure change for quota relief and stable reasoning performance

### Vision

Azure AI Foundry has been an excellent security and safety construct (native prompt shields, governed deployment, UAMI auth). However, the current 20k TPM quota on Grok 4.1 models plus frequent 429-driven failovers to OpenAI models is now a material blocker for reliable orchestrator reasoning and enterprise viability.

We will introduce **OpenRouter** as a first-class, drop-in model provider alongside (and temporarily in place of) Azure AI Foundry. This gives us:
- Unlimited quota on the exact Grok 4.1 Fast models we already use.
- Immediate fallback to `minimax/minimax-m2.7` (strong, reliable, cost-effective).
- A clean abstraction so we can flip back to Foundry with zero downstream code changes once Microsoft quota issues are resolved.

### Core Design Principles (Invariants)

- The existing `modelRouter.ts` and downstream LLM call sites **must not change** in behaviour.
- All model selection, reasoning control, cost tracking, error handling, and health tracking must remain abstracted behind a provider interface.
- Switching between Foundry and OpenRouter must be possible with a single Bicep/env flag (`modelProvider: "foundry" | "openrouter"`).
- When using OpenRouter we explicitly accept the loss of Azure-native prompt shields (documented tradeoff).
- Cost tracking for OpenRouter must be wired into the existing telemetry and cost pipeline via OpenRouter’s usage/cost API.

### Target Model Mapping

| Purpose                        | OpenRouter Model ID                  | Reasoning Flag          | Notes |
|--------------------------------|--------------------------------------|-------------------------|-------|
| Primary / Orchestrator (default) | `x-ai/grok-4.1-fast`               | `reasoning.enabled: true` | Full reasoning |
| Fast fallback                  | `x-ai/grok-4.1-fast`               | `reasoning.enabled: false` | Non-reasoning variant |
| Secondary fallback             | `minimax/minimax-m2.7`             | N/A                     | Strong, reliable, cost-effective |

### Architecture Changes

1. **New Provider Abstraction**
   - `src/llm/providers/ModelProvider.ts` (interface)
   - `src/llm/providers/FoundryProvider.ts` (existing logic moved here)
   - `src/llm/providers/OpenRouterProvider.ts` (new)

2. **Model Router Update**
   - `modelRouter.ts` will select provider based on runtime config.
   - All existing `getModel()`, `call()`, `stream()` etc. signatures remain identical.

3. **Configuration**
   - New Bicep parameter + env var: `MODEL_PROVIDER` (`foundry` | `openrouter`)
   - `OPENROUTER_API_KEY` (already present in Key Vault as `OpenRouterApiKey`)
   - Per-model mapping table in config so we can change Grok variants without code changes.

4. **Cost Tracking**
   - OpenRouter usage endpoint (`/api/v1/usage`) polled or streamed after each call.
   - Costs injected into existing `trackEvent("ModelUsage")` with same schema as Foundry.

5. **Error / Throttling Handling**
   - OpenRouter returns standard OpenAI-compatible error codes (429, 500, etc.).
   - Map them cleanly into the existing health tracker and failover logic.
   - No special prompt-shield step when using OpenRouter (logged as explicit tradeoff).

### Safety Note

When `MODEL_PROVIDER=openrouter` we lose Azure’s native prompt shields. This is an accepted temporary tradeoff for quota stability and the current direct-provider cutover intentionally does **not** route OpenRouter calls through an Azure prompt-shield hop. The rest of the four-eyes safety pipeline (schema validation, minimization, spot-check, human confirmation) remains fully in effect.

### Acceptance Criteria

- [ ] New `ModelProvider` interface and two concrete implementations exist.
- [ ] `modelRouter.ts` routes calls to the correct provider based on runtime config.
- [ ] Grok 4.1 Fast (reasoning = true) is the new default primary model when OpenRouter is active.
- [ ] Immediate fallback to Grok 4.1 Fast (reasoning = false) then `minimax/minimax-m2.7`.
- [ ] Cost tracking via OpenRouter usage API is wired into telemetry.
- [ ] All existing E2E probes and DevLoop validations still pass on both `/light` and `/heavy` lanes.
- [ ] Runtime config flag allows instant flip back to Foundry with zero code changes.
- [ ] OpenRouter integration is fully abstracted — no downstream code knows the provider.

**This change must be delivered as a clean, reversible infrastructure layer.** It is the bridge that lets us maintain full reasoning performance while we work with Microsoft on Foundry quota elevation.

*We are the bridge.*
