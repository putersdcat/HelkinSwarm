# HelkinSwarm Project Specification – Addendum Series
## 0zm. Swarm Decomposer and Planner Integration

**Version:** 2.0 (Gold-standard aligned)
**Status:** Phase 1 Implemented, Phase 2 Architectural Pattern Documented
**Owner:** Principal Developer
**Last Updated:** 2026-04-16
**Issue:** #640

---

### 0. Native canonical vs HelkinSwarm adaptation

> Canonical source: `docs/master-azure-grok-swarm-replication-package/`
> main package \u00a71\u20132, `swarm_agent_reasoning_mechanism.md`,
> `swarm_internal_tool_usage_patterns.md`.

The native xAI swarm does **not** have a separate planner or
decomposer activity. Routing is fully baked into the **leader\u2019s first
inference turn**:

- The user query arrives in Grok\u2019s (Helkin\u2019s) context.
- Grok decides \u2014 inside that single inference step, using the
  mandatory Core Reasoning shard (0zh \u00a73.3) \u2014 whether to reason alone,
  delegate via `chatroom_send`, or call external tools in parallel.
- Delegations are just `chatroom_send` calls. There is no explicit
  \u201cSwarmPlan\u201d object, no decomposer LLM, no complexity classifier.
- The swarm-vs-sequential decision is emergent from the leader\u2019s
  prompt + reasoning, not a separate routing stage.

HelkinSwarm\u2019s current implementation (Phase 1) keeps an **explicit
planner + decomposer** in front of the swarm because it has to enforce
cost guardrails, safety gates, and tenant-scoped sub-session rules
that the native swarm doesn\u2019t need. Phase 2 (below) deliberately
moves toward the native pattern: a unified orchestrator where routing
is a planner-visible decision rather than a pre-routing heuristic wall.

| Aspect | Canonical native | HelkinSwarm Phase 1 (shipped) | HelkinSwarm Phase 2 target |
|---|---|---|---|
| Routing decision | Leader\u2019s first inference turn, prompt-driven | Heuristic score + decomposer LLM, pre-routing | Planner LLM sees all modes, chooses as part of reasoning |
| Complexity classifier | None (prompt-driven) | `computeSwarmEligibilityScore()` (0\u201310) | Kept as **signal**, not as gate |
| Retroactive escalation | Implicit (leader can always broadcast mid-turn) | Not supported | Explicit: sequential result \u2192 quality gate \u2192 optional swarm escalation |
| Cost guard | N/A | `SWARM_ELIGIBILITY_THRESHOLD`, `SWARM_ALWAYS_THRESHOLD`, per-turn budgets | Required (#647) before unlocking Phase 2 |

This is the reconciliation called out in issue #671: HelkinSwarm keeps
its planner/decomposer strengths for enterprise control, but
acknowledges that the canonical swarm is **leader-first** and commits
to moving toward it in Phase 2.

---

### 1. Problem Statement

The swarm decomposer (`swarmDecomposerActivity.ts`) and the planner (`planActivity.ts`) operate in loose coordination. The planner classifies request complexity and produces a boolean `swarmEnabled` + heuristic `isSwarmEligible()` gate. The decomposer then receives only the user message and tool list — no shared classification context, no complexity scoring, and no conversation history.

**Core design failure (Phase 1 → Phase 2 evolution):** Heuristic routing gates decide *before* the LLM sees its options. The planner should be the architect of its own path, choosing orchestration modes as part of reasoning, informed but not constrained by heuristic hints.

---

### 2. Phase 1 — Planner Context Threading (Implemented)

**Commit:** `5324da4`

Phase 1 establishes shared classification vocabulary between planner and decomposer without changing the routing architecture.

#### 2.1 Numeric Eligibility Score

`computeSwarmEligibilityScore(message)` returns a 0–10 score based on:
- Research verb count (1 verb: +1, 3+ verbs: +2)
- Verification intent (+1)
- Multi-domain connectors (+2)
- Compound/comparative analysis patterns (+2)
- Multiple question marks (+1)
- Message length > 200 chars (+1)
- Explicit swarm override phrases (instant 10)

`isSwarmEligible()` delegates to this score with a configurable threshold.

#### 2.2 Complexity Gate Zones

Three named zones classify the score into routing hints:

| Zone | Score Range (default) | Meaning |
|------|-----------------------|---------|
| `always-sequential` | < 3 | Never offer swarm |
| `maybe-swarm` | 3 – 6 | Decomposer co-decides |
| `always-swarm` | ≥ 7 | Swarm should always be tried |

Thresholds are configurable via env vars:
- `SWARM_ELIGIBILITY_THRESHOLD` — sequential ceiling (default: 3)
- `SWARM_ALWAYS_THRESHOLD` — swarm floor (default: 7)

#### 2.3 Expanded Decomposer Input

`SwarmDecomposerInput` now includes:

| Field | Source | Purpose |
|-------|--------|---------|
| `userMessage` | User turn | Original query |
| `correlationId` | Session | Tracing |
| `userId` | Session | Scoping |
| `availableToolNames` | Capability loader | Tool assignment |
| `complexityClass` | Planner classification | `simple` / `compound` / `complex` |
| `swarmEligibilityScore` | Score function | 0–10 numeric confidence |
| `conversationSummary` | OverseerState.summary | Prior conversation context (300 char max) |
| `activeSkillDomains` | Tool name prefixes | Domain expert assignment hint |

The decomposer LLM prompt receives a "Planner context" block with these fields.

#### 2.4 Telemetry

Both `SwarmDecomposerFallback` and `SwarmExecutionStarted` events include:
- `complexityClass`
- `swarmEligibilityScore`
- `swarmComplexityZone`

---

### 3. Phase 2 — Unified Orchestrator with Retroactive Swarm Escalation (Design)

> **Status:** Architectural pattern documented. Not yet implemented.

#### 3.1 Current Routing Model (Phase 1)

```
Request
  → isSwarmEligible() heuristic  ── NO ──→ Sequential solo path
                                  ── YES ─→ Decomposer called
                                            (LLM never sees swarm as an option)
```

The LLM is constrained by a pre-routing decision. The heuristic acts as a **wall**, not a **signal**.

#### 3.2 Target Routing Model (Phase 2)

```
Request
  → Planner sees ALL available orchestration modes:
    • Sequential (single-agent, multi-turn tool loop)
    • Swarm (parallel multi-agent decomposition)
    • Parallel tool execution (fan-out tool calls, single agent)
  → Planner decides routing as part of reasoning
  → Heuristic scores are INPUT SIGNALS (confidence, complexity, resource budget)
  → Safety/cost/quota guardrails remain as hard constraints
```

Key principle: **The LLM is the architect of its own path.** Heuristics are informational inputs, not routing walls.

#### 3.3 Retroactive Escalation

The swarm-vs-sequential decision should be **revisitable mid-turn**:

1. Orchestrator starts on the sequential path by default.
2. After the sequential response, a quality-assessment step evaluates output completeness.
3. If the response is **insufficient, shallow, or incomplete**, the orchestrator escalates to swarm execution.
4. The decomposer receives the sequential path's partial results as additional context.

This means:
- Planner complexity classification is an **initial hint**, not a final verdict.
- Swarm activation is both a **proactive routing** decision and a **fallback escalation**.
- The orchestrator needs a lightweight quality gate after the first sequential response.

#### 3.4 Implementation Sketch

```typescript
// In sessionOrchestrator generator (conceptual)

// Step 1: Plan with all modes visible
const planInput = {
  userMessage,
  availableModes: ['sequential', 'swarm', 'parallel-tools'],
  heuristicHints: {
    swarmEligibilityScore,
    complexityZone,
    activeSkillDomains,
  },
};
const planResult = yield context.df.callActivity('planActivity', planInput);

// Step 2: Execute planned mode
if (planResult.selectedMode === 'swarm') {
  // Proactive swarm — planner chose it
  yield* executeSwarm(context, planResult, decomposerInput);
} else {
  // Sequential path
  const seqResult = yield* executeSequential(context, planResult);

  // Step 3: Quality gate — should we escalate?
  if (planResult.swarmEscalationEnabled && isResponseInsufficient(seqResult)) {
    // Retroactive escalation — sequential answer was too shallow
    yield* executeSwarm(context, planResult, {
      ...decomposerInput,
      priorSequentialResult: seqResult.content,
    });
  }
}
```

#### 3.5 Quality Gate Criteria

The `isResponseInsufficient()` check should evaluate:
- Response length relative to query complexity (very short answer to complex query)
- Presence of hedging language ("I'm not sure", "I don't have enough information")
- Missing tool calls for queries that clearly need external data
- User's explicit dissatisfaction signals in follow-up

#### 3.6 Prerequisites

Phase 2 requires:
1. **Phase 1 complete** — shared classification vocabulary ✅
2. **Planner prompt evolution** — expose orchestration modes as options in the planning prompt
3. **Quality gate activity** — lightweight LLM or heuristic check on sequential output
4. **Decomposer context expansion** — accept prior sequential results as input
5. **Cost guardrails** — retroactive escalation doubles LLM spend; budget enforcement needed (#647)

#### 3.7 Safety Constraints

Heuristic gating is **still appropriate** for:
- Token budget limits (hard cost constraint)
- Rate limiting / quota boundaries
- Safety policy enforcement
- DevLoop context exclusion
- SkillForge request exclusion

These are **legitimate hard constraints**, not capability routing decisions.

---

### 4. Self-Tuning Integration (AC 5)

The infrastructure for self-tuning is in place:
- Complexity scores are captured in telemetry (AC 4)
- Thresholds are configurable via env vars (AC 3)
- Zone classification provides structured labels for analysis

The actual self-tuning loop (adjusting thresholds based on observed swarm success/failure rates) is tracked under #507 (Auto-tuning & evaluation loop epic). The data pipeline is:

```
Telemetry events (swarmEligibilityScore, complexityZone, success/failure)
  → Aggregation (per-zone success rate over N turns)
  → Threshold adjustment (raise/lower SWARM_ELIGIBILITY_THRESHOLD)
  → Applied via env var or config update
```

---

### 5. Related Issues

| Issue | Relationship |
|-------|-------------|
| #640 | This document's parent issue |
| #631 | Swarm epic |
| #632 | Swarm hardening (closed) — overlapping decomposer tuning |
| #647 | Per-agent token budget — prerequisite for Phase 2 cost guardrails |
| #507 | Auto-tuning epic — consumes complexity telemetry |
| #645 | Leader as active coordinator — Phase 2 adjacent |
