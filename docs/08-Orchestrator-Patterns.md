# HelkinSwarm Project Specification

## 8. Orchestrator Patterns (Refined)

### Core Concept

The orchestrator layer is the **brain and nervous system** of HelkinSwarm. It is built entirely on **Azure Durable Functions** using the eternal overseer pattern. This single persistent orchestration instance maintains long-horizon context across days or weeks without ever hitting context limits or losing state.

The orchestrator is deliberately kept deterministic and lightweight. All side-effects, reasoning, and tool execution are delegated to activities, sub-agents, and the safety pipeline (0e).

### High-Level Flow

```mermaid
graph TD
    A[Teams Message] --> B[Bot Framework]
    B --> C[Overseer<br/>Eternal Orchestrator]
    C --> D[Prompt Shields + Safety Gates (0e)]
    D --> E[Session Sub-Orchestrator]
    E --> F[Build Prompt<br/>+ Just-in-Time Skill Memory (0i)<br/>+ Hydra-Net (0k)]
    F --> G[LLM Call (global frontier default)]
    G --> H[Tool Dispatch + Registry (0a)]
    H --> I[Executor Agents + Verification Pipeline (0e)]
    I --> J[Durable Hooks Registration (0h)<br/>if long-running]
    J --> K[Send Reply Activity]
    C -.->|80% context → summarize + ContinueAsNew| C
    style C fill:#1e3a8a,stroke:#60a5fa
```

### Eternal Overseer (`src/orchestrator/overseer.ts`)

The overseer is the only permanent Durable instance. It never ends — it processes one message, then calls `ContinueAsNew()` to restart with a fresh history and carried-over summary.

**Key responsibilities**:
- Token budget tracking (80% threshold triggers summarization)
- Session state management across restarts
- External event handling (`NewMessage`, `ConfirmationResponse`, durable hook callbacks)
- Graceful `ContinueAsNew` with summary + `recentHistory` + relevant skill memory injection (0i)
- Coordination of long-running durable hooks (0h)

### Session Sub-Orchestrator (`src/orchestrator/sessionOrchestrator.ts`)

Handles one complete turn:
- Loads just-in-time skill memory vaults (0i)
- Applies Hydra-Net multimodal embeddings if needed (0k)
- Builds the prompt (persona + history + tools + model profile)
- **Classifies request complexity** (simple/compound/complex) using structural message analysis only — no domain or tool-name heuristics (#324)
- For compound/complex requests: calls the fast model to generate a structured execution plan; injects plan as a system message before the main LLM call
- For planned requests: dispatches only the **next dependency-ready plan step(s)** each round, so the plan materially constrains execution order, model pairing, and sub-agent fan-out instead of acting as advisory text only
- For simple requests: planning is skipped entirely (zero overhead)
- Calls the LLM (global frontier model by default)
- Dispatches tool calls
- Runs the full safety/verification pipeline (0e)
- Registers durable hooks for open-ended workflows (0h)
- Returns the final result to the overseer

### Intra-Session Agent Swarm (`src/orchestrator/swarm/`)

For complex multi-domain queries, the session sub-orchestrator can activate a **parallel swarm execution** instead of the standard sequential tool loop. The swarm is an intra-session capability — all agents live and die within a single user turn. Epic: #631.

#### Activation Gate

`computeSwarmEligibilityScore()` in `planActivity.ts` scores the request 0–10 based on structural signals (multi-domain mentions, compound task indicators, geographic specificity, parallel sub-task potential). Score ≥ 3 triggers swarm activation. The planner outputs `swarmEligibilityScore` as telemetry for future threshold tuning. The decomposer also has a fallback: it returns `{fallback: true}` if it determines the query is too simple after seeing the planner context.

#### Swarm Execution Flow

```
swarmDecomposerActivity (LLM call)
  → SwarmPlan: {agents[{name, role, task, assignedTools, persona, tokenBudget, modelOverride}], leader}
  swarmOrchestrator (Durable sub-orchestrator)
  ├─ 1. Init SwarmChatroom Durable Entity (fire-and-forget)
  ├─ 2. Fan-out: parallel swarmWorkerActivity × N agents (60 s timeout each)
  │         Each agent: multi-turn LLM loop with assigned tools + chatroom_send + swarm_wait
  ├─ 3. Fan-in: collect worker results + outbound chatroom messages
  ├─ 3.4a. Sub-session interception: elevated tool (requiresSubAgent) requests
  │         dispatched via swarmSubSessionActivity (isolated UAMI activity boundary)
  ├─ 3.4.  Leader delegation pass: swarmLeaderActivity(delegationMode) reviews
  │         first-pass transcript, sends targeted follow-up via chatroom_send (30 s)
  ├─ 3.5.  Second-pass: agents with inbound messages / pending swarm_wait get
  │         a brief follow-up activity (maxRounds: 2, 20 s timeout)
  ├─ 4.    Leader synthesis: swarmLeaderActivity produces polished final answer
  │         from full Durable Entity transcript
  └─ 5.    persistSwarmResultActivity → sendReplyActivity → Teams
              swarmMemoryCommitActivity (Leader-only T3 write, async)
```

#### Key Swarm Files

| File | Responsibility |
|------|----------------|
| `src/orchestrator/swarm/swarmDecomposerActivity.ts` | LLM-driven task decomposition → SwarmPlan |
| `src/orchestrator/swarm/swarmOrchestrator.ts` | Fan-out/fan-in sub-orchestrator |
| `src/orchestrator/swarm/swarmWorkerActivity.ts` | Per-agent multi-turn tool loop |
| `src/orchestrator/swarm/swarmLeaderActivity.ts` | Leader synthesis + delegation mode |
| `src/orchestrator/swarm/swarmSubSessionActivity.ts` | Isolated execution of elevated tools |
| `src/orchestrator/swarm/swarmChatroomEntity.ts` | Durable Entity for inter-agent messaging |
| `src/orchestrator/swarm/swarmPersonas.ts` | System prompt builders — loads `src/persona/*.md` files |
| `src/orchestrator/swarm/swarmMemoryCommitActivity.ts` | Leader-only T3 memory commit |
| `src/orchestrator/swarm/swarmTypes.ts` | Zod schemas: SwarmPlan, ChatroomMessage, SwarmWorkerInput/Result |

#### Swarm Personas

Four canonical agent persona files live in `src/persona/`:

| File | Agent | Role |
|------|-------|------|
| `agentOnePersona.md` | Helkin (Leader) | Team coordinator & final synthesizer |
| `agentTwoPersona.md` | Benjamin | Research & verification specialist |
| `agentThreePersona.md` | Harper | Tool orchestration & deep browsing |
| `agentFourPersona.md` | Lucas | Data synthesis, rankings & code execution |

`buildWorkerSystemPrompt()` loads persona files at runtime. Decomposer-assigned `agentPersona` fields (non-default) are appended as behavioral guidance. Per-model persona specialization is supported via `personaFile` override.

#### Collaboration Primitives

Workers have two virtual tools beyond their assigned domain tools:
- **`chatroom_send`** — sends structured messages (text, delegation, question, status) to specific agents or broadcasts to `All`. Collected by the orchestrator and routed via second-pass injection.
- **`swarm_wait`** — synthesis agents call this before ranking/comparing to yield and wait for peer data. Triggers the second-pass pass for that agent. If no peer messages arrive within the second-pass window, a graceful timeout context is injected.

#### Elevated Tool Safety (Sub-Session Handoff)

Tools with `requiresSubAgent: true` cannot be called directly by swarm workers. Workers emit a `sub_session_request` chatroom message; the orchestrator routes it to `swarmSubSessionActivity`, which executes the tool in an isolated activity boundary with UAMI auth, safety-mode check, and no token exposure to workers. The result is injected back as a `sub_session_result` message in the second-pass.

Domains gated behind `requiresSubAgent`: `azuremcp`, `github`, `graphenterprise`, `outlook`, `research`, `teams`.

#### Spec References

- `docs/0ze` — Swarm Architecture and Chatroom Protocol
- `docs/0zf` — Agent Specialization and Parallel Tool Surface
- `docs/0zg` — Inter-Agent Communication Deep Dive
- `docs/0zh` — Canonical Swarm Personas and System Prompts
- `docs/0zi` — Swarm Memory Architecture
- `docs/0zl` — Swarm Implementation Roadmap and Remaining Gaps

#### Swarm-Specific Rules

- ❌ Never put elevated tool execution inside `swarmWorkerActivity` — all such calls must go through `swarmSubSessionActivity`
- ❌ Never import new Durable activities without adding them to `src/functions/index.ts` (silent hang — no error, no timeout message)
- ❌ Never add entity reads/writes inside Durable Activities — Activities cannot interact with Durable Entities; only orchestrators can
- ❌ Never have the Leader write to T3 memory directly — use `swarmMemoryCommitActivity`
- ❌ Never spawn the swarm for a query that the decomposer classifies as `{fallback: true}` — the orchestrator re-routes to sequential on fallback

---

### Critical Patterns & Rules

**ContinueAsNew**  
Called automatically when token budget hits 80%. Two mechanisms preserve context across restarts:
1. **Summary** — compressed long-term context from the current session
2. **`recentHistory`** — the last 10 raw conversation turns (user + assistant pairs), stored in `OverseerState.recentHistory` and injected by `buildPromptActivity.ts` for immediate multi-turn coherence

Both are carried through `ContinueAsNew` so the LLM always has both long-term summary and recent conversation context.

**External Events**  
All communication from the bot, DevLoop relay (0g), and durable hooks uses Durable external events. This allows non-blocking, asynchronous awakening.

**Activity Functions**  
Every side-effect (LLM call, tool execution, reply sending, hook registration) must be an activity function. The orchestrator itself must remain deterministic.

**Idempotent Side-Effects**  
Externally visible side-effects must also be idempotent. Durable retries, planner retries, and multi-round tool loops are allowed to revisit intent, but the emitting activity/handler must suppress duplicate external effects using a stable semantic dedup key. The canonical primitive is the outbound-artifact claim path documented in `docs/0t-Idempotency-and-External-Side-Effects.md`.

**Sub-Agent Isolation**  
Tool calls run in isolated sub-agent sessions (fresh LLM context, secondary model, minimal context only).

**Durable Hooks Integration (0h)**  
The overseer can register persistent hooks for long-running workflows. These survive `ContinueAsNew` and wake the orchestrator when external events occur.

### Runtime Asset References

Attachment-bearing workflows must use **runtime asset references** rather than shoving raw bytes through prompts or arbitrary tool arguments.

Core rules:
- binary payloads are persisted in ephemeral runtime storage and addressed by a typed reference envelope
- downstream tools should pass the reference object (or its id/locator), not the original bytes
- the model should normally see only a **summary of the asset reference** (content type, size, filename, expiry), not the raw payload
- raw bytes should only be materialized for a tool/activity step that explicitly needs them (for example: outbound file send, attachment download, image/document processing)
- runtime assets are short-lived and carry explicit `expiresAt` / `ttlSeconds` lifecycle data so attachment-bearing workflows do not silently become durable long-term storage

This keeps multimodal and file workflows composable while preserving data minimization and keeping prompt context lean.

### Key Files

| File | Responsibility |
|------|----------------|
| `src/orchestrator/overseer.ts` | Eternal orchestrator loop + ContinueAsNew |
| `src/orchestrator/sessionOrchestrator.ts` | One-turn sub-orchestration + swarm routing |
| `src/orchestrator/buildPromptActivity.ts` | Prompt assembly with skill memory + Hydra-Net |
| `src/orchestrator/llmActivity.ts` | LLM call (adapts to global/EU mode) |
| `src/orchestrator/toolDispatchActivity.ts` | Routes tool_calls to handlers |
| `src/orchestrator/planActivity.ts` | Request complexity scoring + swarm eligibility gate |
| `src/orchestrator/sendReplyActivity.ts` | Proactive Teams replies |
| `src/orchestrator/tokenBudget.ts` | 80% context threshold logic |
| `src/orchestrator/stateManager.ts` | Loads session context from Cosmos (includes `recentHistory`, model, safetyMode) |
| `src/orchestrator/durableHookActivity.ts` | Registers and manages long-running hooks (0h) |
| `src/orchestrator/swarm/` | Swarm sub-system (decomposer, orchestrator, workers, leader, chatroom entity) — see swarm section above |
| `src/bot/conversationStore.ts` | Canonical outbound-artifact idempotency claim store |

### What NOT to Do

- ❌ Never put side-effects (HTTP calls, DB writes, tool execution) directly in the orchestrator — always use activities.
- ❌ Never call `ContinueAsNew` after yielding to an activity.
- ❌ Never store full conversation history in the orchestrator input forever — always summarize at threshold.
- ❌ Never bypass the safety pipeline or skill-memory injection.
- ❌ Never treat durable hooks as simple sub-agents — they are first-class persistent entities.
- ❌ Never assume a mutating tool is safe just because the orchestrator already filtered duplicate calls once.
