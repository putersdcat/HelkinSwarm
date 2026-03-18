# HelkinSwarm Project Specification

## 0c. Bring-Your-Own-Key External LLM Support

**Feature Specification**  
**Version:** 1.0 (Unchained Edition)  
**Date:** March 2026  
**Status:** Long-term guidance + MVP narrow-scope implementation plan

### 1. Overview

HelkinSwarm’s LLM layer is designed to be **provider-agnostic** from the beginning. While Azure AI Foundry remains the default backbone (especially for business mode), the architecture must support **Bring-Your-Own-Key (BYOK)** external providers (OpenRouter, xAI, OpenAI, Anthropic, etc.) without compromising core safety features.

This spec defines:
- **Long-term vision** for full external LLM support.
- **MVP narrow implementation** focused on OpenRouter via BYOK, routed through the existing Azure model router and safety pipeline.

### 2. Long-Term Vision

**Goal:** Any user (personal or commercial) can configure HelkinSwarm to use their own API keys for any supported provider while retaining:
- Azure-native prompt sanitization / Content Safety proxy
- Model-specific tool masking & self-tuning evaluation loop
- Unified observability, cost tracking (where available), and safety architecture

**Target providers (future):** OpenRouter, xAI, OpenAI, Anthropic, Grok native, etc.

### 3. MVP Scope (Narrow Delivery)

For the initial release we implement **only** basic OpenRouter support via BYOK, with the following constraints:

- All external LLM calls **must still route through the Azure model router** (or a thin proxy layer inside the runtime).
- Azure Content Safety / prompt shields remain mandatory and run **before** the external call.
- Model-specific profiles, benchmarking, and self-tuning (from 0b) must work on parity with Azure-hosted models.
- Primary / secondary model definitions remain configurable at the **IaC / Bicep level** (via parameters).

### 4. Configuration & Modularity (Link to 0a)

This feature directly embodies the **Modularity & Configuration Strategy** defined in **0a-Modularity-and-Config.md**.

- LLM provider selection is lifted into central configuration (environment variables + future config.json).
- The model router becomes a pluggable abstraction layer.
- Skills library, tool presentation masks, and evaluation loop are completely decoupled from the underlying provider.
- No hard-coded endpoints or auth logic anywhere in core code.

### 5. Architecture for MVP

```mermaid
graph TD
    A[Runtime Orchestrator] --> B[Model Router]
    B --> C[Azure AI Foundry (default)]
    B --> D[External Proxy Layer<br/>OpenRouter BYOK]
    D --> E[Azure Content Safety Proxy<br/>(mandatory)]
    E --> F[OpenRouter Endpoint<br/>(user key)]
    F --> G[Model-Specific Profile Applicator]
    G --> H[Self-Tuning Eval Loop]
```

**Key flow for external calls:**
1. Prompt → Azure Content Safety (sanitization + shields)
2. Sanitized prompt + tools → Model Router
3. Router forwards to OpenRouter using user-provided key
4. Response returns through the same verification pipeline

### 6. IaC / Bicep Handling

Add a new Bicep parameter:

```bicep
param llmProvider string = 'azure'   // azure | openrouter
param openRouterApiKey string = ''   // only used when llmProvider = openrouter
```

- When `llmProvider = azure`: use Foundry as before (global default).
- When `llmProvider = openrouter`: route through the proxy layer using the provided key.
- Primary / secondary model names remain configurable in Bicep (e.g. `primaryModel = 'grok-beta'` for OpenRouter).

### 7. Model Profiles & Self-Tuning Parity

All capabilities from **0b** (model-specific masks, benchmarking, auto-tuning) must apply equally to external models:
- Model profiles stored in `model-profiles/` continue to work.
- DevLoop evaluation loop runs the same benchmarks against OpenRouter models.
- Tool presentation, progressive reveal, naming conventions, etc. are provider-agnostic.

### 8. Cost Tracking Note

Where the provider offers a cost-tracking endpoint (OpenRouter, xAI, etc.), we will default to calling it for real-time token cost estimation.  
For providers without native tracking, we fall back to public pricing tables + token counting.

### 9. Future Expansion Path

- Add native support for xAI, OpenAI, Anthropic, etc.
- Allow multiple providers simultaneously (e.g. primary = OpenRouter, fallback = Azure).
- Full multi-library skills support (see 0a).
