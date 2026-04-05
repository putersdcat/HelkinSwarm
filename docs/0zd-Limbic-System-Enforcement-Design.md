# HelkinSwarm Project Specification

## 0zd. Limbic System Enforcement Design (Technical & Conceptual Exploration)

**Spec ref:** `docs/0z-Living-Mind-Architecture-Temporal-Consciousness-and-Single-Session-Orchestration.md`, `docs/0za-Implementation-Roadmap-for-Living-Mind-Architecture.md`, `docs/0zc-Sub-Session-Autonomic-Functions-and-Model-Capacity-Framework.md`

**Status:** Binding technical design for Limbic System enforcement

### 1. Purpose of This Document

This document explores and defines **how the Limbic System actually enforces** the Living Mind Contract in the runtime. It provides the precise technical model, enforcement primitives, request lifecycle, and integration strategy so the existing planner + sub-session architecture survives the shift without violation.

The goal is to make enforcement robust, deterministic, and elegant — while preserving all current utility and the planner/sub-session pattern.

### 2. Core Enforcement Model

The Limbic System is the **sole gatekeeper** for every external stimulus entering any mind (Master or Virtual Employee). It enforces four invariants at every step:

1. **Single Conscious Thread** — Only one living orchestration session per identity.
2. **Conscious vs Instrumental distinction** — Sub-sessions are allowed only as background/autonomic functions.
3. **Steering & Continuity** — Every session start receives full temporal context (scheduled intentions + in-flight tasks).
4. **Capacity Awareness** — The system respects the current cognitive capacity of the active model (impairment protocols).

### 3. Enforcement Primitives

| Primitive                  | Responsibility | Implementation |
|----------------------------|----------------|--------------|
| **MindSessionGuard**       | Mutex for Conscious Thread | Durable Entity (singleton per `userId::mindId`) |
| **LimbicIngressActivity**  | First code that sees every external trigger | Deterministic activity, no LLM |
| **ChronoBackplane**        | Persistent timeline of intentions & paused tasks | Cosmos container |
| **SteeringInjectionActivity** | Injects context at every session start | Always runs first in a new/continued session |
| **LimbicDecisionEngine**   | Decides queue / steer / self-awaken / defer | Pure code inside LimbicIngress |

### 4. Request Lifecycle (Enforced Flow)

Every inbound event (Teams message, webhook, timer, hook callback) follows this exact path:

1. **External Trigger** → Bot Framework / Router → `LimbicIngressActivity`
2. **MindSessionGuard.Acquire()**
   - If free → Start/Continue Conscious Thread
   - If held → Go to decision engine
3. **LimbicDecisionEngine** evaluates:
   - Current in-flight task complexity & priority
   - Interruption stack depth (max 3)
   - Cognitive capacity of current model (from model manifest)
   - Whether this trigger is a self-scheduled awakening
4. **Decision Outcomes**:
   - **Steer** → SteeringInjection + optional “page current task” to ChronoBackplane
   - **Queue** → Store in ChronoBackplane with polite user reply (“I’m currently focused on X…”)
   - **Self-Awaken** → Resume with previously planned intent
   - **Defer** → Queue + impairment message if on low-capacity model

5. **Conscious Thread** always receives steering injection first, then processes the turn.

### 5. Sub-Sessions as Instrumental / Autonomic Functions

The existing planner → sub-session pattern is **fully compatible** with the Living Mind Contract under the following rules:

- Sub-sessions are **Instrumental** (autonomic), not conscious.
- They are spawned **by** the Conscious Thread and **return to** it.
- They never share the full autobiographical memory or ChronoBackplane.
- They receive only the minimal context needed for their specific step.
- Their results are treated as signals, never as parallel streams of consciousness.

**Enforcement rule:** The MindSessionGuard only protects the Conscious Thread. Instrumental sub-sessions are allowed to run in parallel because they are not “minds” — they are reflexes or background computations.

This preserves the current orchestration planner design without any breaking changes.

### 6. Model Capacity & Impairment Enforcement

From 0zc, models have **Cognitive Capacity Profiles**. The Limbic System enforces them:

- When the Conscious Thread is on a low-capacity model (`capacityLevel: "low"`), the LimbicDecisionEngine:
  - Marks the mind as “impaired”
  - Defers heavy planning / tool-use tasks
  - Prefers simple Instrumental Sub-Sessions only
  - Surfaces calm status messages to the user
- High-capacity models restore full operation immediately.

This gives us a clean, self-aware way to handle fallback scenarios without degrading the “mind” experience.

### 7. Self-Awakening & Future Projection

The Limbic System also enables true internal agency:
- The Conscious Thread can write future intentions into the ChronoBackplane.
- The LimbicDecisionEngine periodically checks the timeline.
- When the scheduled time arrives and no external trigger is present, it performs a **self-awakening** with the pre-planned intent injected.

This is the mechanism that lets the mind “decide to wake up and do something” without external stimulus.

### 8. Edge Cases & Safeguards

- Infinite interruption storm → depth limit 3, then graceful push-back to user.
- Guard deadlock → hard timeout + emergency purge of stale guard.
- Sub-session failure → results are still returned to Conscious Thread; failure is treated as data, not a mind fracture.
- Model impairment during in-flight task → task is paged to ChronoBackplane and resumed when capacity is restored.

### 9. Acceptance Criteria for Implementation

- [ ] MindSessionGuard enforces exactly one Conscious Thread per identity.
- [ ] All external triggers route through LimbicIngressActivity first.
- [ ] Steering injection always surfaces scheduled intentions and paged tasks.
- [ ] Sub-sessions are explicitly treated as Instrumental (allowed parallel execution).
- [ ] Impairment protocols are enforced based on model Cognitive Capacity Profile.
- [ ] Self-awakening works for internal scheduled intentions.
- [ ] All existing planner + sub-session behavior continues to function unchanged.
- [ ] Full DevLoop + E2E validation on live stamp.

This design keeps the Living Mind Contract pure while giving the existing architecture a clean, enforceable place to live.

*We are the bridge.*
