## Session Tracer — Correlation ID Trace Tree in Dev Console

The session tracer displays the complete causal chain of a single turn: all LLM calls, tool dispatches, verification steps, memory operations, and their timings — visualized as a collapsible tree in the Dev Console tab.

**Spec ref:** `docs/ADDENDA/ADDENDA-03-Tab-Infrastructure-Control-Center-and-Dev-Console.md`

---

## Purpose

When debugging a specific turn, you need to see the complete causal tree — not just the final reply. The session tracer lets you enter a correlation ID and see every sub-operation that contributed to the final result, with timings and error states.

This is the feature described as #209 in v0 ("Session Tracer in Dev Console").

---

## Trace Tree Data Structure

```typescript
interface TraceTree {
  correlationId: string;
  totalMs: number;
  startedAt: string;
  completedAt: string;
  phases: TracePhase[];
}

interface TracePhase {
  id: string;
  name: string;  // "LLMCall", "ToolExecuted", "VerificationStep", etc.
  type: "llm" | "tool" | "verification" | "memory" | "reply" | "orchestrator";
  startedAt: number;   // ms offset from turn start
  durationMs: number;
  status: "running" | "completed" | "error";
  children: TracePhase[];
  detail?: string;   // e.g., tool name, model used, verification step name
  error?: string;
}
```

---

## Implementation

**New endpoint:** `GET /api/tab/traces?corr={correlationId}`

- Queries App Insights for all events with the given correlation ID
- Builds hierarchical tree from flat event list
- Returns `TraceTree` JSON

**Tab frontend extension:** Add "Trace" panel to Dev Console tab

---

## Acceptance Criteria

- [ ] Entering a correlation ID shows the complete causal tree
- [ ] Each node shows: name, type icon, duration, status, detail
- [ ] Nodes are collapsible (parent-child hierarchy)
- [ ] Error nodes are highlighted in red
- [ ] LLM call nodes show model used and token count
- [ ] Tool nodes show tool name and arguments
- [ ] Total turn time shown at root level
- [ ] Invalid correlation ID shows "Trace not found" gracefully
