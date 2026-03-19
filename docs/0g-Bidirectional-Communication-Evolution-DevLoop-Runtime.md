# HelkinSwarm Project Specification – Addendum Series
## 0g. Bidirectional Communication Evolution (DevLoop ↔ Runtime)

**Version:** 1.0 (Unchained Edition)  
**Status:** Core Architecture Requirement – MVP Blocking  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-13

### 1. Purpose & Vision
The bidirectional channel between the **DevLoop agent** (running inside VS Code + GitHub Copilot Chat via custom MCP extension) and the live **HelkinSwarm runtime** (Teams bot + Durable Functions orchestrator) is the single most powerful self-improvement mechanism in the entire system.

It transforms HelkinSwarm from a one-way tool user into a **living, introspectable organism** that can be questioned, steered, debugged, and evolved in real time by another instance of itself.  

This is the bridge that lets the developer-side LLM “ask the patient how it feels” instead of blindly guessing from the outside.

### 2. Current Implementation (as of archive)
- MCP-based test harness (teams_test_full_probe) running locally in the IDE.
- Uses user-impersonated OAuth tokens (auto-renewed every ~45 min).
- Prefix-based radio protocol:
  - `DEVLOOP: [DL-YYYYMMDDHHMMSS-U5H0] ... OVER`
  - `DEVQUERY: ... OVER`
- Runtime responds with `HELKIN:` or `SWARM:` prefixed messages.
- Messages are injected into the dedicated HelkinSwarm Teams chat thread via stored ConversationReference.
- Correlation IDs appended for tracing (visible in dev console tab — served from global SPA; data from stamp tab backend — see #107).
- Used for health checks, tool enumeration, safety proxy testing, and PR validation.

### 3. Target Architecture (MVP Requirement)
We replace the fragile MCP + impersonation model with a **dedicated, first-class relay**:

1. **Durable Functions Relay Container** (`ide-messages` Cosmos DB collection)
   - Acts as a secure, persistent message bus between IDE and runtime.
   - Supports push (DevLoop → Runtime) and pull/poll (runtime can proactively surface data).

2. **Protocol Evolution**
   - Keep human-auditable prefixes for now (DEVLOOP:, DEVQUERY:, HELKIN-REPLY:, SWARM-TOOL-REPORT:, etc.).
   - Add structured JSON payload schema with:
     ```json
     {
       "type": "DEVQUERY" | "DEVLOOP" | "HELKIN-REPLY",
       "correlationId": "DL-20260313102900-U7K2",
       "source": "ide-copilot" | "runtime-orchestrator" | "sub-agent",
       "target": "orchestrator" | "specific-tool" | "model-profile",
       "payload": { ... },
       "over": true
     }
     ```
   - Support **steering injections** (non-terminating) and **session resurrection** commands.

3. **Native LLM-to-LLM North Star (Post-MVP)**
   - Direct KV-cache / latent-space handshake between DevLoop instance and runtime orchestrator.
   - Zero token loss, sub-millisecond steering, black-box during active dev cycles (only for controlled environments).
   - Fallback to current text protocol when cross-cloud or auditability required.

### 4. Key Use Cases (must be supported Day 1)
- Tool introspection: “Tell me exactly what tools you see right now and which model is routing them.”
- Safety validation: Send adversarial prompts through the Azure prompt shields and observe rejection behavior.
- Model-specific masking verification: Ask runtime to dump its current tool aliasing for Grok-4.1-fast-reasoning vs o4-mini.
- Session resurrection: “The dev session just OOM’d — restart with ignition prompt v3 and continue from issue #312.”
- Self-tuning loop: Runtime reports “I hallucinated these 3 tool calls last session” → DevLoop updates model-profile mask.

### 5. Integration Points
- **MCP Extension** (`CopilotResurrection`): Listens for relay messages and can inject into running Copilot Chat session or start new one.
- **Teams Bot** receives via Durable trigger and routes directly to orchestrator (bypassing normal user prompt path).
- **Cosmos DB** stores full conversation + embeddings for retrospective analysis in the Dev Console tab (served from global SPA; data from stamp tab backend — see #107).
- **App Insights** automatically tags every bidirectional message with `devloop-correlation-id`.

### 6. Security & Safety Considerations
- Separate Entra App Registration for DevLoop identity (never user tokens in production).
- Short-lived scoped tokens (5 min) + explicit consent flow.
- All DevLoop messages run through the same prompt shields and verification pipeline.
- Emergency kill switch in orchestrator: any message containing `DEVLOOP-KILL` aborts current session.

### 7. What NOT to Do
- Do **not** keep using user-impersonated tokens long-term.
- Do **not** rely on Playwright browser automation for message injection.
- Do **not** treat bidirectional channel as just another tool — it is infrastructure.
- Do **not** allow un-prefixed or unauthenticated messages to reach the orchestrator.

### 8. Acceptance Criteria
- DevLoop can send `DEVQUERY: list all current tools and active model` and receive accurate, structured reply within <8 seconds.
- Session resurrection works after forced termination.
- Full trace appears in Dev Console tab with expandable reasoning chains (served from global SPA; data from stamp tab backend — see #107).
- Protocol schema is versioned and backward-compatible.
- North Star KV-cache path is documented with spike task for Q3 2026.

### 9. Backlog Linkage
- Ties directly into 0a (Modularity), 0b (Model Profiles), 0e (Safety Pipeline), and future 0h (Virtual Employees).
- Enables the entire self-improving organism.
