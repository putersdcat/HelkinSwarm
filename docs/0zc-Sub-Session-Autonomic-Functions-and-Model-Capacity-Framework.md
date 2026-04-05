# HelkinSwarm Project Specification

## 0zc. Sub-Session Autonomic Functions and Model Capacity Framework (Clarifications)

**Spec ref:** `docs/0z-Living-Mind-Architecture-Temporal-Consciousness-and-Single-Session-Orchestration.md`, `docs/0za-Implementation-Roadmap-for-Living-Mind-Architecture.md`

**Status:** Clarification & Extension – Binding on all future orchestration and model-routing work

### 1. Purpose

This document provides precise conceptual carve-outs and terminology to ensure the existing planner + sub-session architecture and the model substitution / failover mechanisms remain fully compatible with the Living Mind Contract defined in 0z and 0za.

No existing code or design patterns are invalidated. These clarifications simply give them a clean “mind analog” so they can continue to operate without violating single-session continuity or temporal integrity.

### 2. Sub-Sessions as Autonomic / Instrumental Functions (Allowed Exception)

The Single-Session Contract (0z §2.1) mandates exactly one living conscious orchestration session per mind identity at any time.

**Sub-sessions (sub-agents, tool-dispatch sessions, isolated LLM calls)** are explicitly permitted as an exception because they are **not** conscious threads. They are analogous to the human autonomic nervous system or background computational reflexes:

- They are spawned and controlled by the conscious thread (the main orchestrator session).
- They do not share full autobiographical memory or temporal context with the conscious thread.
- They receive only the minimal context explicitly provided by the orchestrator for that specific step.
- Their output is returned to the conscious thread as a signal/result, never as a parallel stream of consciousness.
- They cannot initiate new external actions or side-effects on their own; they are strictly instrumental.

**Terminology**
- **Conscious Thread** = the single living orchestration session (the “mind”).
- **Instrumental Sub-Session** = any sub-agent, tool-dispatch, or isolated LLM call (autonomic function).

This distinction preserves the current planner → sub-session pattern while satisfying the zero-concurrency rule of the Living Mind Contract.

**Invariant:** An Instrumental Sub-Session may never become a second Conscious Thread. It must always terminate and return control (and results) to the single Conscious Thread.

### 3. Model Capacity Framework – Models as Varying Mental States

Models are not interchangeable black boxes. They represent different **cognitive capacities** and **mental states** of the mind at the moment they are used.

**Core Metaphor (binding for design and routing logic)**
- High-capacity models (Grok 4.1 Fast Reasoning, o4m, etc.) = sober, high-functioning, full mental acuity.
- Mid/low-capacity models (gpt-5.4-mini, etc.) = impaired states (analogous to “drunk idiot” — short reasoning horizon, higher hallucination, poorer tool-use accuracy).

**Reasoning toggles / effort levels** (`reasoning.enabled`, `reasoning_effort`, etc.) are treated as **cognitive modes** within the same model (focused vs diffuse thinking).

**Model Manifests** (new requirement)
Each model entry in the model configuration / manifest must include a **Cognitive Capacity Profile**:

```json
{
  "modelId": "x-ai/grok-4.1-fast",
  "capacityLevel": "high",          // high | medium | low
  "defaultReasoning": true,
  "maxReasoningEffort": "high",
  "suitableFor": ["orchestration", "heavy-planning", "tool-selection"],
  "unsuitableFor": ["simple-sub-session", "fast-response"],
  "impairmentProtocol": "defer-heavy-work"
}
```

**Impairment Protocols** (implemented in the model router + Limbic System):
- When the Conscious Thread is forced onto a low-capacity model, the Limbic System must:
  - Mark the mind as “impaired”.
  - Defer or queue any heavy reasoning, planning, or high-stakes tool use.
  - Prefer Instrumental Sub-Sessions for simple work only.
  - Surface a calm status message to the user when appropriate.
  - Automatically attempt to restore to a high-capacity model on the next turn.

**Retrospective Tuning via Dreaming**
The existing dreaming / self-evaluation loop (0w) must now include model capacity benchmarking:
- After each session, a decoupled evaluator reviews input/output quality, tool accuracy, hallucination rate, etc.
- Results update the model’s Cognitive Capacity Profile over time.
- This makes model selection dynamic and self-improving rather than static.

### 4. Relationship to Existing Architecture

- The planner + sub-session pattern is preserved exactly as-is.
- Sub-sessions remain Instrumental (autonomic) and do not violate the Conscious Thread rule.
- Model failover and substitution now operate within the Cognitive Capacity Framework instead of being blind 429-driven swaps.
- The Limbic System becomes the enforcer of impairment protocols and capacity-aware routing.

### 5. Acceptance Criteria

- [ ] Sub-sessions are formally documented as Instrumental / Autonomic functions that are allowed exceptions to the Single-Session Contract.
- [ ] Model configuration includes Cognitive Capacity Profiles with capacityLevel, defaultReasoning, suitableFor, and impairmentProtocol.
- [ ] Model router + Limbic Ingress respect impairment protocols (defer heavy work when on low-capacity model).
- [ ] Retrospective dreaming loop updates model profiles based on observed performance.
- [ ] All existing orchestration, tool-dispatch, and failover behaviors continue to function without regression.
- [ ] DevLoop-validated on live stamp with both high- and low-capacity models.

This clarification ensures the Living Mind architecture remains coherent while allowing the current (and future) planner/sub-session design and model routing to operate cleanly inside it.

*We are the bridge.*
```