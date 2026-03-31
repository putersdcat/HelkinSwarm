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
3. **Safety Filter** — `toolRegistry.getSafetyFiltered()` removes any tool that violates the current safety mode. In read-only mode, `getUpToRisk('low')` returns only low-risk tools. In confirmation-gated/full-destructive, all tools are returned.
4. **Prompt Builder** — `buildPromptActivity.ts` calls `getSafetyFiltered()` for the tool summary and `toFunctionSchemas()` for the LLM's function schemas. Also injects just-in-time skill memory (0i) + Hydra-Net embeddings if present (0k).
5. **LLM returns tool_calls**.  
6. **Tool Dispatch Activity** — `toolDispatchActivity.ts` routes each call to the correct handler. Before execution, `isAllowedBySafetyMode()` provides a defense-in-depth check that rejects tool calls violating the current safety mode, even if the LLM fabricates a tool name.
7. **Sub-Agent Activity** — `subAgentActivity.ts` handles tools marked `requiresSubAgent: true`. Also applies `isAllowedBySafetyMode()` before execution.
8. **Executor Agent** takes over for tools marked `requiresExecutor: true` (the LLM itself never executes destructive actions).
9. **Full Verification Pipeline** (0e) runs after execution.

### Sub-Agent Isolation

Every tool call routed through `requiresSubAgent: true` runs in a **fresh, isolated LLM session** (`subAgentActivity.ts`):
- No shared conversation history with the main overseer.
- Uses the secondary (faster) model by default.
- Receives only the minimal context needed for that specific tool.
- Cannot call other tools recursively.
- Safety mode compliance checked independently via `isAllowedBySafetyMode()`.

This prevents prompt injection bleed and keeps context windows small.

### Runtime Asset Handoff Contract

Attachment-bearing and multimodal workflows use a shared **runtime asset handoff contract** across tools, orchestrator activities, and Teams replies.

#### Producer contract

Asset-producing steps must persist bytes into runtime asset storage and return or carry a typed reference rather than raw payload bytes.

- canonical envelope: `RuntimeAssetReference` in `src/integrations/runtimeAssetStore.ts`
- required shape includes: `id`, `userId`, `correlationId`, `kind`, `contentType`, optional `fileName`, `byteLength`, `sha256`, `source`, `createdAt`, `expiresAt`, `ttlSeconds`, and `storage`
- ingress/tool producers may also emit prompt-safe notices alongside references when an attachment was skipped, truncated, or transformed

Examples:
- Teams ingress persists uploaded files/images before overseer handoff and carries them as `runtimeAssets` + `attachmentNotices`
- Outlook attachment download persists the selected attachment and returns a `runtimeAsset` reference instead of base64 file bytes

#### Orchestrator contract

The orchestrator carries references, not payloads.

- `SessionInput.runtimeAssets` and `BuildPromptInput.runtimeAssets` carry asset references through the turn
- `attachmentNotices` carry prompt-safe ingestion outcomes without inventing fake assets
- `buildPromptActivity.ts` injects only summary metadata for the model (filename, content type, byte size, expiry, attachment kind)
- the LLM should normally see reference summaries, not raw file bytes

This keeps prompts lean and preserves data minimization.

#### Consumer contract

Consumers resolve bytes only at the step that truly needs them.

- downstream tools should accept an asset id or reference and resolve content inside the handler/activity that needs it
- `sendReplyActivity.ts` consumes `assets: RuntimeReplyAssetInput[]` and resolves runtime asset references at send time
- image replies materialize image bytes only for the outbound Teams message; non-image files use the file-consent send path without stuffing the bytes into prompt context

#### Safety and data minimization rules

- raw bytes stay out of prompt/tool-call text unless a specific execution step explicitly requires rendering or transformation
- the default model-facing representation is `buildRuntimeAssetPromptSummary(...)`
- asset references are ephemeral and TTL-bound; they are workflow transport, not durable user storage
- cross-skill handoff should prefer `assetId` / typed reference passing over copying bytes between tool results

#### Scenario anchors

The current contract is intended to cover at least these reusable shapes:

1. **Inbound → action**
  - Teams upload → ingest to runtime asset storage → prompt-safe summary to orchestrator/model → downstream tool consumes reference

2. **External source → reply**
  - Outlook attachment → download into runtime asset storage → reply path resolves reference → Teams receives the file/image artifact

#### Key contract surfaces

| Surface | Current contract |
|------|-------------------|
| `src/integrations/runtimeAssetStore.ts` | canonical runtime asset reference envelope + TTL-backed storage |
| `src/bot/inboundAttachmentIngestion.ts` | Teams ingress producer path (`runtimeAssets`, `attachmentNotices`, optional `imageUrls`) |
| `src/orchestrator/buildPromptActivity.ts` | model sees summary metadata, not raw payload bytes |
| `skills/outlook/handlers.ts` | external-source producer path via `outlook_download_attachment` |
| `src/orchestrator/sendReplyActivity.ts` | outbound consumer path from runtime asset refs to Teams attachments |

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
