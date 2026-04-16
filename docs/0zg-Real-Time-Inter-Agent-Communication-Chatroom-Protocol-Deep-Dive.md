# HelkinSwarm Project Specification

## 0zg. Real-Time Inter-Agent Communication — Chatroom Protocol Deep Dive

**Spec ref:** `docs/0ze-Intra-Session-Swarm-Architecture-and-Chatroom-Protocol.md`, `docs/0zf-Swarm-Agent-Specialization-Dynamic-Decomposition-and-Parallel-Tool-Surface.md`, `docs/0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md`

**Status:** Implementation Blueprint — Communication backbone of 0ze  
**Owner:** Principal Developer  
**Last Updated:** 2026-04-16

---

### 0. Native canonical behavior vs HelkinSwarm adaptation

> Source of truth for native behavior: `docs/master-azure-grok-swarm-replication-package/`
> (especially Docs 01, 08, 09, 10, 11 and `swarm_agent_reasoning_mechanism.md`).
> HelkinSwarm preserves the native application-level protocol and adds
> enterprise-grade transport, schema, and audit on top.

#### 0.1 Canonical `chatroom_send` tool (native xAI swarm)

Natively, **one and only one** tool parameter schema exists, and it is
shared by all four agents:

```json
{
  "name": "chatroom_send",
  "description": "Send a message to other agents in your team. If another agent sends you a message while you are thinking, it will be directly inserted into your context as a function turn. If another agent sends you a message while you are making a function call, the message will be appended to the function response of the tool call that you make.",
  "parameters": {
    "properties": {
      "message": { "type": "string" },
      "to":      { "anyOf": [
        { "type": "string", "enum": ["Grok","Benjamin","Harper","Lucas","All"] },
        { "type": "array",  "items": { "type": "string", "enum": ["Grok","Benjamin","Harper","Lucas","All"] } }
      ] }
    },
    "required": ["message", "to"]
  }
}
```

The **whole application-level protocol** (messageType, confidence,
sender, parse-on-receive) is enforced by a **mandatory system-prompt
shard** — *not* by the tool schema. The shard (see §3.2) is the only
thing that teaches the agents the JSON convention.

#### 0.2 HelkinSwarm production refinements (explicit deltas)

| Native canonical | HelkinSwarm adaptation | Rationale |
|---|---|---|
| Single shared schema with self-recipient included in the enum. Agents never choose to self-send because the shard tells them who the teammates are. | **Per-agent differentiated schemas** — each agent’s `to` enum excludes the agent’s own name (see §3.3). | Strictly stronger for production; prevents accidental self-message at the schema layer. Confirmed by the gold-standard package (`10-chatroom-send-architecture-clarification.md`) as a legitimate enterprise refinement, not a deviation. |
| `message` is a raw string carrying a JSON payload the agents agree to produce. | `ChatroomMessage` Zod schema (§3) with `id`, `correlationId`, `replyTo`, `contentType`. | Durable-Functions entity routing and DevLoop transcript auditing require structured transport metadata. The **payload content** still follows the native JSON convention; the Zod fields are transport wrapping. |
| Recipient sees `Chat with [Sender]: From [Sender]: [timestamp] <raw JSON string>`. | Recipient sees formatted `[From {name}]` block with the canonical JSON preserved inline; delivered through Durable Entity drain rather than direct context mutation. | Deterministic orchestration (no side-effects in orchestrator code) per `.github/instructions/orchestrator-patterns.instructions.md`. |
| Chatroom is in-process to the orchestration engine, ephemeral for the duration of the conversation thread. | `SwarmChatroomEntity` Durable Entity, **explicitly destroyed** at end of swarm turn (see §10). | Single-threaded, serialized entity state removes race conditions; lifetime cap enforces the ephemeral invariant. |
| No acknowledgements; no transcript persistence. | Transcript is emitted as telemetry; Leader may promote high-value messages to T3 long-term memory (0zi §6). | Institutional learning across sessions is a HelkinSwarm requirement. |

Everything below this section is HelkinSwarm-specific unless it explicitly
references §0.

---

### 1. Purpose

This document is the **deep technical specification** for the inter-agent communication primitive (`chatroom_send`) introduced in 0ze. It covers:

1. The exact message semantics, delivery guarantees, and timing modes
2. How `chatroom_send` is implemented on Azure Durable Functions
3. How messages are injected into each agent's LLM context window
4. Message formatting, structured data exchange, and prefix conventions
5. The full message lifecycle from send to drain to injection
6. Relationship to the existing bidirectional relay (0g) and durable hooks (0h)

The chatroom is what turns N independent LLM instances into a **collaborative intelligence**. Getting the delivery semantics right is the difference between a swarm that feels alive and a swarm that feels like N independent answers stitched together.

---

### 2. Design Principles

| Principle | Rationale |
|---|---|
| **Instant delivery** | Messages must be available to the recipient on their next reasoning step. Latency kills collaboration quality. |
| **Fire-and-forget send** | The sender never blocks waiting for delivery confirmation. This enables true parallel work. |
| **Ordered per-recipient** | Messages for a given recipient are ordered by send time. No reordering. |
| **No acknowledgement required** | Recipients are not required to respond. The Leader can synthesize from silence. |
| **Auditable transcript** | Every message is logged for observability. The full transcript is the swarm's audit trail. |
| **Ephemeral** | The chatroom and all messages are destroyed when the swarm turn completes. No persistence beyond telemetry. |

---

### 3. Message Schema (Canonical)

```typescript
// src/orchestrator/swarm/chatroomMessage.ts
import { z } from "zod";

export const ChatroomMessageSchema = z.object({
  id: z.string().uuid(),                       // unique message ID
  from: z.string(),                             // sender agent name
  to: z.union([
    z.literal("All"),                           // broadcast
    z.string(),                                 // single recipient
    z.array(z.string()),                        // multiple recipients
  ]),
  content: z.string(),                          // message body
  contentType: z.enum([
    "text",                                     // free-form text (default)
    "partial_result",                           // structured partial finding
    "question",                                 // cross-agent question
    "vote",                                     // consensus vote
    "error",                                    // error report
    "status",                                   // status update / broadcast
  ]).default("text"),
  timestamp: z.number(),                        // Date.now() at send time
  correlationId: z.string(),                    // swarm-level correlation ID
  replyTo: z.string().uuid().optional(),        // optional reference to a previous message
});

export type ChatroomMessage = z.infer<typeof ChatroomMessageSchema>;
```

**Why `contentType`?** It allows the recipient (and the transcript viewer) to understand the intent of each message without parsing the content. The Leader can prioritize `partial_result` messages over `status` messages when synthesizing.

---

### 4. Delivery Engine — Durable Entity Implementation

#### 4.1 Why a Durable Entity?

Durable Functions activities are isolated — they share no memory. The chatroom must be **shared state** that all agents (running as parallel activities) can read from and write to. Azure Durable Entities provide exactly this: a single-threaded, serialized state machine that multiple activities can signal.

#### 4.2 Entity State

```typescript
interface SwarmChatroomState {
  swarmCorrelationId: string;
  registeredAgents: string[];                    // ["Leader", "Alpha", "Beta", "Gamma"]
  queues: Record<string, ChatroomMessage[]>;     // per-agent inbox
  transcript: ChatroomMessage[];                  // ordered log of all messages
  createdAt: number;
  messagesCount: number;
}
```

#### 4.3 Entity Operations

```typescript
// src/orchestrator/swarm/swarmChatroomEntity.ts
import * as df from "durable-functions";
import { ChatroomMessage, ChatroomMessageSchema } from "./chatroomMessage.js";

interface SwarmChatroomState {
  swarmCorrelationId: string;
  registeredAgents: string[];
  queues: Record<string, ChatroomMessage[]>;
  transcript: ChatroomMessage[];
  createdAt: number;
  messagesCount: number;
}

const swarmChatroomEntity = df.app.entity("SwarmChatroom", (ctx) => {
  const state = ctx.df.getState<SwarmChatroomState>() ?? {
    swarmCorrelationId: "",
    registeredAgents: [],
    queues: {},
    transcript: [],
    createdAt: Date.now(),
    messagesCount: 0,
  };

  switch (ctx.df.operationName) {
    // Initialize the chatroom with registered agents
    case "init": {
      const input = ctx.df.getInput<{
        correlationId: string;
        agents: string[];
      }>();
      state.swarmCorrelationId = input.correlationId;
      state.registeredAgents = input.agents;
      for (const agent of input.agents) {
        state.queues[agent] = [];
      }
      break;
    }

    // Send a message — routes to recipient queues
    case "send": {
      const raw = ctx.df.getInput<unknown>();
      const msg = ChatroomMessageSchema.parse(raw);

      // Validate sender is registered
      if (!state.registeredAgents.includes(msg.from)) {
        break; // silently drop messages from unknown agents
      }

      state.transcript.push(msg);
      state.messagesCount++;

      const recipients = msg.to === "All"
        ? state.registeredAgents.filter(a => a !== msg.from) // broadcast excludes sender
        : Array.isArray(msg.to)
          ? msg.to
          : [msg.to];

      for (const r of recipients) {
        if (state.queues[r]) {
          state.queues[r].push(msg);
        }
        // Messages to unregistered agents are silently dropped
      }
      break;
    }

    // Drain all pending messages for an agent
    case "drain": {
      const agentName = ctx.df.getInput<string>();
      const messages = state.queues[agentName] ?? [];
      state.queues[agentName] = [];
      ctx.df.return(messages);
      return; // early return — don't set state after return
    }

    // Get the full transcript (for observability / Leader synthesis)
    case "transcript": {
      ctx.df.return(state.transcript);
      return;
    }

    // Get stats (for monitoring)
    case "stats": {
      ctx.df.return({
        messagesCount: state.messagesCount,
        pendingByAgent: Object.fromEntries(
          Object.entries(state.queues).map(([k, v]) => [k, v.length])
        ),
      });
      return;
    }
  }

  ctx.df.setState(state);
});
```

#### 4.4 Entity ID Convention

```typescript
// Entity ID is derived from the swarm's correlation ID
const chatroomEntityId = new df.EntityId(
  "SwarmChatroom",
  `swarm-${swarmCorrelationId}`
);
```

This ensures one chatroom per swarm, and the entity ID is deterministic from the correlation ID.

---

### 5. Message Flow — From Send to LLM Injection

#### 5.1 Worker Sends a Message

Inside a worker activity, after completing a tool call:

```typescript
// Inside swarmWorkerActivity.ts
async function sendChatroomMessage(
  ctx: df.OrchestrationContext,   // or activity context with entity client
  chatroomEntityId: df.EntityId,
  from: string,
  to: string | string[],
  content: string,
  contentType: string = "text",
  correlationId: string,
) {
  const msg: ChatroomMessage = {
    id: crypto.randomUUID(),
    from,
    to,
    content,
    contentType,
    timestamp: Date.now(),
    correlationId,
  };
  // Signal is fire-and-forget — worker does not block
  ctx.df.signalEntity(chatroomEntityId, "send", msg);
}
```

#### 5.2 Worker Drains Messages

Before each LLM reasoning step, the worker drains its inbox:

```typescript
// Inside the worker's reasoning loop
const pendingMessages = await ctx.df.callEntity(
  chatroomEntityId,
  "drain",
  agentName,
) as ChatroomMessage[];
```

#### 5.3 Messages Injected into LLM Context

Drained messages are formatted and injected as additional context before the worker's next LLM call:

```typescript
function formatChatroomForContext(messages: ChatroomMessage[]): string {
  if (messages.length === 0) return "";
  
  const formatted = messages.map(m =>
    `[From ${m.from}${m.contentType !== "text" ? ` (${m.contentType})` : ""}] ${m.content}`
  ).join("\n\n");

  return `\n--- TEAM MESSAGES ---\n${formatted}\n--- END TEAM MESSAGES ---\n`;
}
```

This formatted block is appended to the worker's conversation as a **system turn** or **function result**, depending on timing:

- **Between LLM calls** → injected as a new system message
- **After a tool call** → appended to the tool's result string

Both produce the same effect: the LLM sees teammate messages as part of its natural context flow.

#### 5.4 Canonical native injection semantics (authoritative)

From the gold-standard package (Docs 01, 08, 11), the exact native
behavior that HelkinSwarm replicates at turn boundaries is:

1. **Recipient is currently thinking (no tool call outstanding)** →
   incoming message is inserted as a **function turn** in the
   recipient’s context before the next inference step. In HelkinSwarm
   this maps to the drain-between-activities boundary (§5.2).
2. **Recipient has a tool call in flight** → incoming message is
   **appended to the function response** of that tool call. If the
   recipient has **multiple parallel tool calls outstanding**, the
   message is appended to the **first tool response that returns** —
   it never interrupts mid-execution, and it is never duplicated to
   every parallel result. HelkinSwarm reproduces this by draining the
   entity inside the first returning tool-result handler and prepending
   the formatted team-messages block to that single result string.
3. **Sender’s own context is not updated with its own outbound message**
   — the model already knows what it sent. HelkinSwarm preserves this:
   we never echo `send` back into the sender’s queue.
4. **User Info + Current time shards are re-injected at the start of
   every turn** for every agent (see 0zh §3.4 for the shard body). This
   is a native invariant, not an optional optimization.

> LLM inference calls are **atomic** — there is no mid-stream token
> injection during an in-flight generation. Messages are always
> delivered at a turn boundary (either between LLM calls or appended to
> a tool result). This is architecturally guaranteed by our Durable
> Functions model: each LLM call is an activity, and entity drain
> happens between activities.

---

### 5.5 Canonical JSON payload convention (native application layer)

The `message` field of every `chatroom_send` call natively carries a
**valid JSON string** with the following fields (see package Doc 08):

```json
{
  "messageType": "thinking" | "tool_summary" | "analysis" | "response" | "question" | "contribution" | "final_contribution",
  "content":     "your full text",
  "confidence":  92,
  "sender":      "Helkin" | "Benjamin" | "Harper" | "Lucas",
  "timestamp":   "optional ISO-or-relative",
  "data":        { "optional": "rich payload" }
}
```

- `messageType` is drawn from the canonical seven-value enum. Additional
  values may be added but the seven above cover ~99% of real traffic.
- `confidence` is **always** included (0–100). Downstream agents weigh
  contributions by it.
- Pretty-printed or minified are both valid.

This payload convention is **injected via a mandatory system-prompt
shard on every agent** (see 0zh §3.2). It is not enforced by the
tool schema — the tool simply carries opaque string content.

HelkinSwarm mapping: the canonical JSON payload is carried inside
`ChatroomMessage.content`. The Zod wrapper fields (`id`, `from`, `to`,
`correlationId`, `replyTo`, `contentType`) are **transport metadata**,
not payload. `ChatroomMessage.contentType` MAY shadow the canonical
`messageType` at the transport level for entity routing, but agents
MUST still parse the JSON payload in `content` to get confidence,
sender attribution, and the full messageType taxonomy.

---

### 6. Message Formatting Conventions

#### 6.1 Prefix Convention

All chatroom messages should include the sender name. Since the chatroom injects `[From {name}]` automatically, agents should NOT duplicate the prefix in their content.

**Good:**
```
content: "Found Rocky Mountain and Friends in Munich. Address: Fromundstr. 34. Confirmed FOX partner."
→ Injected as: [From Alpha] Found Rocky Mountain and Friends in Munich...
```

**Bad:**
```
content: "[Alpha] Found Rocky Mountain..."
→ Injected as: [From Alpha] [Alpha] Found Rocky Mountain...  ← redundant
```

#### 6.2 Structured Data in Messages

For complex data, agents should use inline structured formats:

```
content: "SHOPS_FOUND:\n- Rocky Mountain and Friends | Fromundstr. 34, Munich | FOX certified | In-city\n- MBorg Products | Höhenkirchen | FOX partner | 15 min drive"
```

The Leader's synthesis prompt instructs it to parse structured chatroom data. Full JSON is acceptable but verbose — prefer compact inline formats.

#### 6.3 Questions and Follow-Ups

Agents can ask each other questions:

```
contentType: "question"
content: "Can you cross-check whether MBorg is still an active FOX partner? Their site loaded slowly."
to: "Alpha"
```

The recipient's LLM naturally handles this because the question appears as context in their next reasoning step.

---

### 7. Timing, Ordering, and Concurrency

#### 7.1 Timing Model

```
t=0     Swarm starts. All agents begin their first LLM call in parallel.
t=300ms Alpha completes web_search. Sends partial result to Leader.
t=400ms Beta completes browse_page. Sends verification to Leader. Sends question to Alpha.
t=500ms Alpha drains inbox. Sees Beta's question. Adjusts next search.
t=600ms Gamma receives partial results from Leader broadcast. Starts ranking.
t=800ms Alpha sends follow-up result to Leader.
t=1000ms Leader drains inbox. Has all three agents' results. Begins synthesis.
t=1500ms Leader completes synthesis. Returns to Conscious Thread.
```

**Key insight**: Messages are not instantaneous in the Durable Entity model (entity operations are serialized). But entity operations are fast (sub-millisecond state mutations), so the effective latency is negligible compared to LLM call latency.

#### 7.2 Ordering Guarantee

- Messages **from** a single sender are ordered by send time (because one agent sends sequentially).
- Messages **to** a single recipient from different senders may interleave by arrival time.
- The drain operation returns messages in arrival order (FIFO per recipient queue).
- The transcript is globally ordered by entity processing order (effectively by send time with minor jitter).

#### 7.3 Concurrency Model

The Durable Entity is **single-threaded** — all operations (`send`, `drain`, `init`, etc.) are processed one at a time. This eliminates race conditions by design. Multiple agents can concurrently signal the entity, and the entity processes signals in order.

This is a critical advantage of the Durable Entity model over shared-memory approaches.

---

### 8. Relationship to Existing Communication Primitives

HelkinSwarm already has several communication mechanisms. The chatroom is **new** and **complementary**.

| Primitive | Scope | Lifetime | Direction | Used For |
|---|---|---|---|---|
| **Durable External Events** | Overseer ↔ Bot / Hooks | Cross-turn | Inbound to orchestrator | User messages, webhook callbacks, timer events |
| **Bidirectional Relay (0g)** | Overseer ↔ DevLoop | Cross-session | Bidirectional | Self-improvement, debugging, protocol comms |
| **Durable Hooks (0h)** | Overseer ↔ External Systems | Cross-turn, persistent | Event-driven | Long-running workflow triggers |
| **swarmEventBus (0v)** | Master ↔ Virtual Employees | Cross-orchestrator, persistent | Bidirectional | Inter-employee coordination (future) |
| **Chatroom (this doc)** | Leader ↔ Workers within turn | Single turn (ephemeral) | Bidirectional multi-party | Intra-session parallel agent collaboration |

**Chatroom is the only primitive designed for real-time, ephemeral, multi-party communication within a single execution turn.** All others are designed for persistence and cross-turn/cross-session communication.

#### 8.1 Chatroom → swarmEventBus Evolution Path

The chatroom protocol is a lightweight precursor to the `swarmEventBus` from 0v. When Virtual Employees arrive:

- The chatroom's **message schema** and **delivery semantics** can be reused
- The **Durable Entity** implementation upgrades to a persistent entity (not destroyed after one turn)
- The **agent registration** expands from ephemeral worker names to persistent Virtual Employee identifiers
- The **transcript** becomes a persistent audit log rather than turn-scoped telemetry

This is by design — the chatroom is the prototype for the full swarm communication backbone.

---

### 9. Observability and Debugging

#### 9.1 Transcript as First-Class Telemetry

The full chatroom transcript is emitted as part of the `SwarmTelemetry` payload (defined in 0ze §8.1). Each message includes:

- Sender and recipient(s)
- Content type
- Timestamp (for timing analysis)
- Correlation ID (for cross-referencing with LLM traces and tool call logs)
- Reply-to chain (for conversation threading)

#### 9.2 DevLoop Integration

The DevLoop relay (0g) can surface the chatroom transcript:

```
DEVLOOP: show swarm transcript for correlation abc-123
```

Returns the full message timeline with agent names, timestamps, and content — enabling post-hoc analysis of swarm collaboration quality.

#### 9.3 Dev Console Tab Visualization

The Dev Console Tab shows swarm runs as an expandable timeline:

```
┌─ Swarm Run [abc-123] — 4 agents, 12 messages, 1.5s
├── t=0ms     [Alpha → Leader]   "Found 3 FOX shops near Munich"
├── t=100ms   [Beta  → Leader]   "Verified Rocky Mountain — FOX-trained"
├── t=150ms   [Beta  → Alpha]    "Cross-check MBorg?"
├── t=200ms   [Alpha → Beta]     "Confirmed — /fox-service/ page exists"
├── t=350ms   [Gamma → Leader]   "Ranking: 1. Rocky Mountain, 2. MBorg"
├── t=500ms   Leader synthesis    → Final answer produced
└── Total: 12 messages, 4200 tokens, quality score 0.92
```

---

### 10. Security Considerations

| Concern | Mitigation |
|---|---|
| **Prompt injection via chatroom** | Messages between agents are injected as structured context with clear delimiters (`--- TEAM MESSAGES ---`). The LLM cannot confuse teammate messages with user input or system instructions. |
| **Agent impersonation** | The entity validates that `msg.from` matches a registered agent. Unknown senders are rejected. Workers cannot send messages as "Leader" or as another worker. |
| **Data exfiltration** | Chatroom messages never leave the Durable Entity. They cannot be sent to the user or to external systems. Only the Leader's final synthesis reaches the user. |
| **Unbounded message volume** | Hard cap: 100 messages per swarm. After the cap, new messages are dropped and the Leader is signaled to wrap up. |
| **Entity persistence** | The entity is explicitly deleted after the swarm turn completes. No chatroom state survives beyond the turn. |

---

### 11. Implementation Checklist

- [ ] Define `ChatroomMessage` Zod schema in `src/orchestrator/swarm/chatroomMessage.ts`
- [ ] Implement `SwarmChatroomEntity` in `src/orchestrator/swarm/swarmChatroomEntity.ts`
- [ ] Register entity in `src/functions/index.ts`
- [ ] Implement `sendChatroomMessage()` helper for worker activities
- [ ] Implement `drainAndFormat()` helper for LLM context injection
- [ ] Implement `formatChatroomForContext()` with proper delimiters
- [ ] Add chatroom transcript to `SwarmTelemetry` payload
- [ ] Wire transcript to DevLoop relay
- [ ] Add message volume cap (100 messages per swarm)
- [ ] Add entity cleanup after swarm completion
- [ ] Integration test: two workers exchange messages via entity
- [ ] Integration test: Leader drains all messages and produces synthesis

---

### 12. Backlog Linkage

- Core communication backbone for 0ze (Intra-Session Swarm Architecture)
- Prototype for `swarmEventBus` in 0v (Children of HelkinSwarm)
- Integrates with 0g (Bidirectional Relay) for DevLoop observability
- Integrates with 0n (Turn-by-Turn Debug Telemetry) for trace correlation
- Transcript data feeds into 0m (Self-Tuning Eval Loop) for swarm effectiveness analysis
- T2 chatroom layer defined within 0zi (Three-Tier Memory Architecture)
- **Epic**: #631 — Intra-Session Agent Swarm implementation

*We are the bridge.*
