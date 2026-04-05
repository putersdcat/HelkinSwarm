### 05-Codepath-Deep-Dive.md

**Codepath Deep-Dive – Key Paths, Orchestrator, Skill Integration & Tech Debt (2026-04-02)**

**Core Orchestrator Codepaths (the brain)**

- **Eternal Overseer** (`src/orchestrator/overseer.ts`)  
  → Correctly uses `ContinueAsNew()` at 80% token budget.  
  → Drains pending external events before restart.  
  → Healthy, but still carries only a summary + hook IDs forward (no full quoted context elevation yet).

- **Session Sub-Orchestrator** (`src/orchestrator/sessionOrchestrator.ts`)  
  → One-turn execution path is clean.  
  → Calls `buildPromptActivity` → `llmActivity` → `toolDispatchActivity`.  
  → DiscoveryToolInjection + exact-tool forcing logic is now present (recent fixes #478/#477).  
  → Still has residual drift in some follow-up paths (#485).

**Tool Dispatch & Skill Integration Layer**

- `src/capabilities/capabilityLoader.ts` + `skills/*/handlers.ts`  
  → Declarative manifest + auto-registration works well.  
  → MCP skills (Azure, Graph Enterprise, Microsoft Learn) are correctly wired via `mcpConnector.ts`.  
  → Exact-tool pinning and deterministic JSON replies are now in place.

**Key Integration Points**

- **Auth Layer** (`src/auth/*`): OBO + scoped tokens + MSAL cache plugin are solid.
- **Memory** (`src/memory/*` + Cosmos): Skill-specific vaults exist but JIT injection is still under-used in many paths.
- **Safety Pipeline**: Five-step verification is architecturally present but some high-risk paths still rely too heavily on LLM reasoning instead of executor agents.

**Major Tech Debt Identified in Code**

1. **Discovery → Execution Gap** (biggest current risk)  
   Many discovery paths still fall back to prose instead of forcing the discovered tool. Recent fixes helped exact-tool cases, but natural-language follow-ups are still brittle.

2. **Operational State Modelling**  
   Skills can be “installed” in the registry but not actually operational in the tenant (especially new MCP skills). No strong runtime health signal yet.

3. **Quoted Context Continuity**  
   Quoted messages are in the prompt, but not yet elevated into strong deterministic routing state for follow-ups.

4. **Sub-Agent Isolation**  
   `subAgentActivity.ts` exists but is still under-utilized in many skill handlers.

**Positive Code Health Notes**
- Recent commits show excellent evidence-based validation style (live probes, telemetry, deploy links).
- Capability groups and manifest v2 are being actively extended.
- Trunk-based development with direct-to-main commits is working cleanly.

**Overall Codepath Maturity**
The **brain** (orchestrator) and **reflexes** (skills) are ahead of the **honesty layer** at the product edge. The architecture is sound; the execution reliability and user-facing truthfulness are the current limiting factors.
