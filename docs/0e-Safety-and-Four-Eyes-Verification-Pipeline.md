# HelkinSwarm Project Specification

## 0e. Safety & Four-Eyes Verification Pipeline

**Feature Specification**  
**Version:** 1.0 (Unchained Edition)  
**Date:** March 2026  
**Status:** Core requirement – mandatory for all sub-agent and SkillForge responses

### 1. Core Principle

**Four-Eyes Everywhere**  
No sub-agent or SkillForge output is ever trusted at face value. The orchestrator acts as the skeptical supervisor: it validates, cross-checks, minimizes, and only then decides next steps.  

This pipeline runs on **every** tool response — read-only searches, SkillForge prototypes, delete queues — regardless of domain or model lane (global frontier default or EU DataZoneStandard toggle).

### 2. Mandatory Pipeline Steps (executed sequentially)

1. **Schema Validation**  
   - Strict JSON schema check against the tool’s `outputSchema` from the capability manifest.  
   - Failure → drop response, log anomaly with correlation ID, notify user (“Sub-agent returned malformed data — retrying or aborting”).  
   - Prevents hallucinated fields or adversarial text.

2. **Data Minimization**  
   - Strip every field not explicitly listed in `outputSchema`.  
   - Example: a search tool only ever returns `{ messageIds, senders }` — never full bodies or attachments unless the manifest explicitly allows it.  
   - Goal: shrink token usage and shrink attack surface.

3. **Spot-Check Verification (the “second pair of eyes”)**  
   - Always performed unless the tool manifest explicitly disables it (rare, only for ultra-low-risk internal metadata).  
   - Logic (token-efficient):  
     - If result count ≤ 10 → verify **all** IDs via narrow batched GET.  
     - If result count > 10 → random sample of 5 IDs (configurable).  
   - Compare against original query pattern.  
   - Mismatch → flag as suspicious, log, ask user for clarification or abort.

4. **Prompt Shields Layer**  
   - Azure Content Safety (Prompt Shields) is invoked **twice per cycle**:  
     - On incoming user message (before routing).  
     - On sub-agent output **before** orchestrator reasoning begins.  
   - Blocks jailbreak attempts and adversarial injections.  
   - Skipped only inside the orchestrator’s trusted internal reasoning loop.

5. **Risk-Tiered Human Confirmation**  
   - Driven by the tool’s `risk` value in the capability manifest (low / medium / high).  
   - **Low**: silent (proceed).  
   - **Medium**: spot-check only.  
   - **High** (delete, move, create, any delegated personal-data action):  
     - Orchestrator posts clear Teams summary card with impact details.  
     - User must reply **YES** or describe changes.  
     - Configurable auto-threshold (e.g., <10 items in dev mode).

### 3. Special Handling for Destructive Executors

- Delete/move/create actions **never** use an LLM sub-agent.  
- Orchestrator feeds only the vetted, spot-checked ID list to a dumb non-LLM executor Activity Function.  
- Executor receives a cryptographically signed payload (session ID + hash of original read output) — rejects anything that doesn’t match.  
- Still runs through the full pipeline (schema + minimization) before queuing.

### 4. SkillForge Integration

- SkillForge output (PR link + manifest + generated code) is treated as a special high-risk response.  
- Pipeline runs full schema + spot-check (basic lint/test summary).  
- Prompt Shields applied to every reasoning step inside the container.  
- Final PR creation still requires human + reviewer approval before hot-reload.

### 5. Performance & Efficiency Guarantees

- Spot-checks use narrow Graph/GitHub filters (`$select=` only needed fields) — typically <200 tokens total.  
- All steps are parallelizable where possible (schema + minimization run concurrently).  
- Typical added latency: 300–800 ms per tool call (negligible for enterprise workflows).  
- Token impact: <1 % of a normal session.

### 6. Logging & Audit Trail

Every pipeline run is logged to App Insights / Sentinel with:
- Full correlation ID (ties user request → sub-agent → verification steps → final action).  
- Before/after JSON snapshots.  
- Prompt Shields detection results.  
- Human confirmation response (YES/NO + timestamp).  
- Anomalies auto-alert (e.g., repeated spot-check failures → pause orchestrator).

### 7. Example – “Find & Delete messages from Bob Smith”

1. User: “Delete all messages from Bob Smith.”  
2. Orchestrator → read-only sub-agent (delegated token if personal).  
3. Sub-agent returns IDs + senders.  
4. Pipeline:  
   - Schema OK  
   - Minimize (only IDs/senders)  
   - Spot-check: batch GET on all IDs → verify senders  
   - Prompt Shields clean  
   - High-risk → Teams card: “Found 7 messages from Bob Smith. Delete them?”  
5. User replies **YES** → signed IDs → dumb delete executor → success.

This pipeline is the single source of truth for safety in HelkinSwarm. It is non-negotiable, always-on, and designed to scale to every future plugin without modification.
