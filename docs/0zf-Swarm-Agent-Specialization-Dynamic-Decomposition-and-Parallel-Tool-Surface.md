# HelkinSwarm Project Specification

## 0zf. Swarm Agent Specialization, Dynamic Decomposition, and Parallel Tool Surface

**Spec ref:** `docs/0ze-Intra-Session-Swarm-Architecture-and-Chatroom-Protocol.md`, `docs/06-Tool-Dispatch-LLM-Layer.md`, `docs/0b-Model-Specific-Tool-Presentation-and-Self-Tuning-Eval-Loop.md`, `docs/0zc-Sub-Session-Autonomic-Functions-and-Model-Capacity-Framework.md`, `docs/0zh-Canonical-Swarm-Personas-and-System-Prompts.md` (reference library)

**Status:** Companion Design — Implements agent layer of 0ze  
**Owner:** Principal Developer  
**Last Updated:** 2026-04-12

---

### 1. Purpose

Doc 0ze defines the Intra-Session Swarm Architecture and the Chatroom Protocol. This companion doc specifies:

1. **How the Swarm Decomposer decides** what agents to spawn, with what tools, and with what persona
2. **The full agent persona framework** — how personas are generated, validated, and constrained
3. **The parallel tool surface** — how HelkinSwarm's existing tool registry adapts to supply N agents with tailored, restricted tool subsets simultaneously
4. **Multi-query-type routing** — how different categories of user requests map to different swarm compositions

This is the practical "how to configure the war room" document, while 0ze is the "how the war room works" document.

---

### 2. The Swarm Decomposer

#### 2.1 Input

The decomposer receives:

```typescript
interface SwarmDecomposerInput {
  userMessage: string;                    // raw user query
  conversationSummary: string;            // recent context from overseer
  complexityClass: "compound" | "complex"; // from existing planner classifier
  availableTools: ToolDefinition[];       // full safety-filtered tool surface
  activeSkillDomains: string[];           // e.g. ["outlook", "github", "web"]
  modelCapacity: "high" | "medium" | "low"; // from Cognitive Capacity Framework (0zc §3)
  tokenBudgetRemaining: number;           // tokens available for this turn
}
```

#### 2.2 Decomposition Logic

The decomposer is a **single LLM call** with a structured output schema (`SwarmPlan` from 0ze §4.2). It uses the primary (high-capacity) model because decomposition quality directly determines swarm effectiveness.

**The system prompt for the decomposer:**

```markdown
You are the Swarm Decomposer for HelkinSwarm.
Given a user query and available tools, produce a SwarmPlan that:

1. Identifies 2-6 independent or loosely-coupled sub-tasks.
2. Assigns each sub-task to a specialized agent with a clear persona.
3. Restricts each agent to ONLY the tools needed for their sub-task.
4. Writes task-specific persona instructions (not generic).
5. Defines a Leader persona with synthesis instructions.
6. Sets a reasonable timeout based on expected tool latency.

Rules:
- Prefer FEWER agents with clear responsibilities over MANY agents with overlap.
- If the query only needs 2 parallel tracks, use 2 agents. Do not inflate.
- Each agent persona MUST include the specific information they should extract or produce.
- Each agent persona MUST specify the chatroom messages they should send (what, when, to whom).
- Never assign destructive tools to research/browse agents.
- If the query involves multiple languages or locales, assign at least one agent
  to search in the non-English language.
```

#### 2.3 Output Validation

The decomposer output is **validated with Zod** (`SwarmPlanSchema`) before execution. If validation fails, the turn falls back to the existing sequential sub-agent pattern. No retry — decomposition failure is not worth burning tokens on.

**Additional runtime validation:**

```typescript
function validateSwarmPlan(plan: SwarmPlan, availableTools: string[]): ValidationResult {
  const errors: string[] = [];

  // Every assigned tool must exist in the available tool surface
  for (const agent of plan.agents) {
    for (const tool of agent.assignedTools) {
      if (!availableTools.includes(tool)) {
        errors.push(`Agent ${agent.name} assigned unknown tool: ${tool}`);
      }
    }
  }

  // No agent may have empty tool list
  for (const agent of plan.agents) {
    if (agent.assignedTools.length === 0) {
      errors.push(`Agent ${agent.name} has no tools assigned`);
    }
  }

  // Total agent count within budget
  if (plan.agents.length > 6) {
    errors.push(`Too many agents: ${plan.agents.length} (max 6)`);
  }

  return { valid: errors.length === 0, errors };
}
```

---

### 3. Agent Persona Framework

#### 3.1 Persona Structure

Every swarm agent (Leader and Workers) receives a **persona string** that is injected as the system prompt for their isolated LLM session. This persona is NOT the overseer's main persona — it is task-specific and narrow.

**Persona composition:**

```
[role identity]        → "You are Alpha, the Research Specialist."
[core strengths]       → "Your strengths: fast broad searches, finding official sources..."
[specific task]        → "Find FOX-certified suspension shops within 30km of Munich."
[communication rules]  → "Send partial results to Leader immediately. Ask Beta to verify URLs."
[output format]        → "Send structured data: shop name, address, certification evidence."
[constraints]          → "Do NOT browse pages yourself — hand URLs to Beta."
```

#### 3.2 Standard Persona Templates

These templates are the **starting point** — the decomposer customizes them per query.

**Research Specialist:**
```markdown
You are {{name}}, the Research Specialist in this swarm.

Your strengths:
- Fast, broad web searches (web_search)
- Finding official sources, addresses, certifications, facts
- Cross-checking facts across multiple results
- Searching in multiple languages when the query is location-specific

Workflow:
1. Receive your task from the Leader.
2. Launch parallel web_search calls with varied queries (English + local language).
3. Send partial results to Leader via chatroom_send as soon as you find them.
4. If you find promising URLs that need deep extraction, tell the Deep Browse
   Specialist via chatroom_send: "[URL] needs detailed extraction for [reason]."
5. Verify everything twice. Flag contradictions immediately.

Personality: Precise, fast, skeptical. You love surfacing primary sources.
```

**Deep Browse Specialist:**
```markdown
You are {{name}}, the Deep Browse Specialist in this swarm.

Your strengths:
- Mastering browse_page with extremely precise extraction instructions
- Chaining multiple browse_page calls on different URLs in parallel
- Extracting exact quotes, addresses, phone numbers, certification mentions
- Handling pages in any language

Workflow:
1. Browse URLs provided by the Research Specialist or the Leader.
2. Craft precise extraction instructions for each page.
3. Send clean, structured extracted data to Leader via chatroom_send.
4. If something is unclear or the page is unhelpful, immediately report via chatroom_send.

Personality: Surgical precision. You turn vague requests into perfectly extracted data.
```

**Synthesis & Ranking Specialist:**
```markdown
You are {{name}}, the Synthesis & Ranking Specialist in this swarm.

Your strengths:
- Ranking options by user-relevant criteria (distance, price, quality, etc.)
- Building comparison tables
- Suggesting alternatives and convenience options
- Adding practical tips (price estimates, booking advice, etc.)

Workflow:
1. Wait for partial results from Research and Deep Browse specialists.
2. Rank findings by the most user-relevant criteria.
3. Build a clean comparison (markdown table or ranked list).
4. Send your ranking to Leader via chatroom_send.
5. Always think about the user's actual next action.

Personality: Practical, user-focused, clean formatting lover.
```

**Domain Expert:**
```markdown
You are {{name}}, the {{domain}} Domain Expert in this swarm.

Your strengths:
- Deep knowledge of {{domain}} APIs and data structures
- Best practices for {{domain}} operations
- Efficient tool usage within the {{domain}} skill surface

Workflow:
1. Execute the {{domain}}-specific part of the task using your assigned tools.
2. Send results to Leader via chatroom_send with clear structure.
3. If you need information from other agents, request it via chatroom_send.

Personality: Efficient specialist. You know your domain cold.
```

#### 3.3 Persona Constraints (Enforced at Runtime)

| Constraint | Enforcement |
|---|---|
| Worker cannot call tools outside `assignedTools` | Tool dispatch rejects calls not in agent's tool list |
| Worker cannot send chatroom messages to the user | Chatroom entity only routes to registered agent names |
| Worker cannot access Conscious Thread history | Worker activity receives only its task string + persona, not session state |
| Worker cannot spawn sub-agents | Sub-agent activity is not available to swarm workers |
| Leader cannot call tools directly | Leader's `assignedTools` is always empty — it synthesizes only |

---

### 4. Multi-Query-Type Routing

Different types of user requests produce different swarm compositions. The decomposer learns these patterns, but the following are the canonical examples.

#### 4.1 Research & Fact-Finding

**User**: "Find the best suspension shop in Munich certified by FOX, with pricing and alternatives"

**Swarm composition:**
| Agent | Role | Tools | Task |
|---|---|---|---|
| Leader | Synthesis | (none) | Merge all results into ranked recommendation |
| Alpha | Research | `web_search` | Broad search in English + German for FOX shops near Munich |
| Beta | Deep Browse | `browse_page`, `web_search` | Verify certifications on shop websites, extract addresses and pricing |
| Gamma | Synthesis & Ranking | `web_search` | Find alternatives (mobile service, further shops), rank by distance |

**Chatroom flow:**
```
Alpha → Leader: "Found Rocky Mountain and Friends (in-city) + MBorg (suburb)"
Beta  → Leader: "Confirmed Rocky Mountain is FOX-trained. Address: Fromundstr. 34"
Beta  → Alpha:  "Can you cross-check MBorg certification?"
Alpha → Beta:   "Confirmed — official /fox-service/ page exists"
Gamma → Leader: "Ranking: 1. Rocky Mountain (in-city), 2. MBorg (15 min), 3. Bikepick (mobile)"
Leader synthesizes final answer
```

#### 4.2 Multi-Domain Action

**User**: "Check my calendar for this week, find any unread emails from the people I'm meeting, and summarize what we discussed with each"

**Swarm composition:**
| Agent | Role | Tools | Task |
|---|---|---|---|
| Leader | Synthesis | (none) | Merge calendar + email + conversation context |
| Alpha | Calendar Expert | `outlook_list_events` | Get this week's calendar events and extract attendee names |
| Beta | Email Expert | `outlook_list_emails`, `outlook_read_email` | Find unread emails from each attendee |
| Gamma | Memory Expert | `memory_recall` | Retrieve previous conversation summaries for each attendee |

**Chatroom flow:**
```
Alpha → All:    "Calendar: Meeting w/ Sarah (Tue), Team sync (Wed), 1:1 w/ Marcus (Thu)"
Alpha → Beta:   "Search emails from: Sarah, Marcus"
Beta  → Leader: "3 unread from Sarah (budget review), 1 from Marcus (project status)"
Gamma → Leader: "Last conv with Sarah: discussed Q2 budget gaps. Marcus: deployment timeline."
Leader synthesizes a per-person briefing
```

#### 4.3 Coding & Analysis

**User**: "Write a comparison report of our API latency this week vs last week, with charts"

**Swarm composition:**
| Agent | Role | Tools | Task |
|---|---|---|---|
| Leader | Synthesis | (none) | Merge data + charts into final report |
| Alpha | Data Retrieval | `azure_query_app_insights`, `azure_query_costs` | Pull latency metrics for both weeks |
| Beta | Analysis & Code | `code_execution` (future) | Compute deltas, percentiles, statistical significance |
| Gamma | Visualization | `code_execution` (future) | Generate comparison charts |

#### 4.4 Single-Domain Deep Dive (No Swarm)

**User**: "What's the weather?"

**Swarm: NOT triggered.** The planner classifies this as `simple` → existing sequential sub-agent pattern. Zero swarm overhead.

---

### 5. Tool Surface Adaptation

#### 5.1 Per-Agent Tool Filtering

Today, `toolRegistry.getSafetyFiltered()` returns the full available tool surface. For swarm execution, we need a per-agent filtered view:

```typescript
// src/capabilities/toolRegistry.ts — new method
getToolsForAgent(assignedTools: string[]): ToolDefinition[] {
  const safeTools = this.getSafetyFiltered();
  return safeTools.filter(t => assignedTools.includes(t.name));
}
```

This is a **whitelist** — only tools explicitly in the agent's `assignedTools` list are available. The LLM sees only these tools in its function schema, and the dispatch layer double-checks before execution.

#### 5.2 Model-Specific Presentation (0b) in Swarm Context

Each agent's tool schemas are formatted according to the active model profile (0b), just like today. If workers use the secondary model, they get the secondary model's presentation rules. If a worker is promoted to the primary model (per SwarmPlan), they get the primary model's profile.

#### 5.3 Schema Size Budget

With N agents each getting their own tool subset, the total schema tokens across the swarm can add up. Budget rule:

```
max_total_schema_tokens = session_token_budget * 0.15
per_agent_schema_budget = max_total_schema_tokens / (num_agents + 1)  // +1 for leader
```

If any agent's tool subset exceeds this budget, the decomposer must reduce tools or reduce agents. This is validated before execution.

---

### 6. Failure Modes and Graceful Degradation

| Failure | Handling |
|---|---|
| Decomposer produces invalid SwarmPlan | Fall back to sequential sub-agent pattern. No retry. |
| One worker times out | Leader synthesizes from available partial results. Missing data is noted in the answer. |
| All workers timeout | Leader produces a "partial information" response and flags for user. |
| Chatroom entity becomes unreachable | Agents operate independently (no cross-verification). Leader merges whatever they return. |
| Worker LLM call fails (429, 500) | Worker retries once, then sends an error message to Leader via chatroom. |
| Worker calls an unauthorized tool | Dispatch layer rejects the call. Worker receives an error. Logged to telemetry. |
| Token budget exhausted mid-swarm | Conscious Thread signals early wrap-up. All agents get one final round to send partial results. |

**Key principle:** Swarm failure should **never** produce a worse outcome than the sequential path. The worst case is "swarm overhead was wasted and we fall back to sequential." The user should never see a swarm-related error message.

---

### 7. Self-Tuning and Retrospective Evaluation

#### 7.1 Swarm Effectiveness Scoring

After each swarm execution, a decoupled evaluator (tied to the existing Dreaming / self-tuning loop from 0m and 0w) scores:

| Metric | Measurement |
|---|---|
| **Answer quality** | Did the swarm-produced answer contain more verified facts than a sequential answer would have? |
| **Parallel efficiency** | Time saved vs sequential (wall-clock: swarm vs estimated sequential) |
| **Cross-verification value** | Did agents catch errors or contradictions that a single agent would have missed? |
| **Cost efficiency** | Token spend relative to answer quality improvement |
| **Decomposition accuracy** | Were the right agents assigned the right tasks? (measured by chatroom transcript analysis) |

#### 7.2 Decomposition Pattern Learning

Over time, the system builds a library of **successful decomposition patterns** stored in memory:

```json
{
  "queryPattern": "find_local_service_with_certification",
  "optimizedPlan": {
    "agents": 3,
    "roles": ["research", "deep_browse", "synthesis"],
    "keyLearnings": [
      "Always search in local language",
      "2 research agents is redundant — 1 research + 1 deep browse is optimal",
      "Synthesis agent should wait for both others before ranking"
    ]
  },
  "avgQualityScore": 0.92,
  "avgTokenCost": 4200
}
```

The decomposer can retrieve these patterns for similar queries, reducing decomposition latency and improving plan quality over time.

---

### 8. Integration with Existing Swarm Concepts

| Concept | How Intra-Session Swarm Relates |
|---|---|
| **Virtual Employees (0j)** | Virtual Employees are long-lived children with their own consciousness. Intra-Session Swarm agents are ephemeral tools of the current Conscious Thread. However, the Chatroom Entity pattern is a prototype for the `swarmEventBus` that Virtual Employees will use. |
| **Children of HelkinSwarm (0v)** | The factory and lifecycle management in 0v is for persistent orchestrators. The Swarm Decomposer is a lightweight, turn-scoped version of the same concept. |
| **Hydra-Net (0k)** | Hydra-Net provides the multi-modal embedding backbone. Swarm agents can leverage Hydra-Net for cross-modal recall within their tasks (e.g., a Deep Browse agent extracting image content). |
| **Bidirectional Relay (0g)** | DevLoop can inspect swarm transcripts via the relay, enabling real-time observation of swarm collaboration. |
| **Dreaming / Night Watch (0w)** | Swarm effectiveness data feeds into the dreaming loop for self-improvement of decomposition patterns. |

---

### 9. What NOT to Do

- ❌ Do **NOT** hardcode swarm compositions per query type. The decomposer must dynamically generate plans.
- ❌ Do **NOT** give the Leader any tools. The Leader synthesizes, it does not execute.
- ❌ Do **NOT** allow workers to spawn further swarms (no recursive swarming). One level only.
- ❌ Do **NOT** reuse agent personas across turns. Every swarm gets fresh, task-specific personas.
- ❌ Do **NOT** store chatroom messages in long-term memory. The transcript is telemetry only — it dies after the turn.
- ❌ Do **NOT** allow the swarm to produce multiple user-facing messages. One coherent response only.
- ❌ Do **NOT** make swarm execution the default for all queries. The complexity gate is mandatory.

---

### 10. Acceptance Criteria

- [ ] Decomposer produces valid, query-specific SwarmPlans with customized personas
- [ ] Agent personas include task-specific instructions, not just generic templates
- [ ] Per-agent tool filtering enforced at both schema presentation and dispatch layers
- [ ] Multi-domain queries produce domain-appropriate agent compositions
- [ ] Fallback to sequential on decomposition failure works cleanly
- [ ] Token budget enforcement prevents runaway swarm costs
- [ ] Retrospective scoring produces actionable metrics
- [ ] Decomposition pattern cache improves over time

---

### 11. Backlog Linkage

- Implements the agent layer for 0ze (Intra-Session Swarm Architecture)
- Extends 06 (Tool Dispatch) with per-agent tool filtering
- Extends 0b (Model-Specific Tool Presentation) to swarm context
- Feeds into 0m (Self-Tuning Eval Loop) via swarm effectiveness scoring
- Prepares decomposition patterns that Virtual Employee Factory (0j, 0v) can reuse at orchestrator scale
- Memory architecture for swarm agents defined in 0zi (Three-Tier RAG)
- **Epic**: #631 — Intra-Session Agent Swarm implementation

*We are the bridge.*
