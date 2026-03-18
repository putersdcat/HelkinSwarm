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
- Graceful `ContinueAsNew` with summary + relevant skill memory injection (0i)
- Coordination of long-running durable hooks (0h)

### Session Sub-Orchestrator (`src/orchestrator/sessionOrchestrator.ts`)

Handles one complete turn:
- Loads just-in-time skill memory vaults (0i)
- Applies Hydra-Net multimodal embeddings if needed (0k)
- Builds the prompt (persona + history + tools + model profile)
- Calls the LLM (global frontier model by default)
- Dispatches tool calls
- Runs the full safety/verification pipeline (0e)
- Registers durable hooks for open-ended workflows (0h)
- Returns the final result to the overseer

### Critical Patterns & Rules

**ContinueAsNew**  
Called automatically when token budget hits 80%. The summary + selected skill memory chunks are injected into the new session so context is preserved without bloating history.

**External Events**  
All communication from the bot, DevLoop relay (0g), and durable hooks uses Durable external events. This allows non-blocking, asynchronous awakening.

**Activity Functions**  
Every side-effect (LLM call, tool execution, reply sending, hook registration) must be an activity function. The orchestrator itself must remain deterministic.

**Sub-Agent Isolation**  
Tool calls run in isolated sub-agent sessions (fresh LLM context, secondary model, minimal context only).

**Durable Hooks Integration (0h)**  
The overseer can register persistent hooks for long-running workflows. These survive `ContinueAsNew` and wake the orchestrator when external events occur.

### Key Files

| File | Responsibility |
|------|----------------|
| `src/orchestrator/overseer.ts` | Eternal orchestrator loop + ContinueAsNew |
| `src/orchestrator/sessionOrchestrator.ts` | One-turn sub-orchestration |
| `src/orchestrator/buildPromptActivity.ts` | Prompt assembly with skill memory + Hydra-Net |
| `src/orchestrator/llmActivity.ts` | LLM call (adapts to global/EU mode) |
| `src/orchestrator/toolDispatchActivity.ts` | Routes tool_calls to handlers |
| `src/orchestrator/sendReplyActivity.ts` | Proactive Teams replies |
| `src/orchestrator/tokenBudget.ts` | 80% context threshold logic |
| `src/orchestrator/stateManager.ts` | Loads session context from Cosmos |
| `src/orchestrator/durableHookActivity.ts` | Registers and manages long-running hooks (0h) |

### What NOT to Do

- ❌ Never put side-effects (HTTP calls, DB writes, tool execution) directly in the orchestrator — always use activities.
- ❌ Never call `ContinueAsNew` after yielding to an activity.
- ❌ Never store full conversation history in the orchestrator input forever — always summarize at threshold.
- ❌ Never bypass the safety pipeline or skill-memory injection.
- ❌ Never treat durable hooks as simple sub-agents — they are first-class persistent entities.
