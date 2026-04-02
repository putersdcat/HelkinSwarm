**docs/0za-Implementation-Roadmap-for-Living-Mind-Architecture.md**

```markdown
# HelkinSwarm Project Specification

## 0za. Implementation Roadmap – Living Mind Architecture (Temporal Consciousness & Single-Session Enforcement)

**Spec ref:** `docs/0z-Living-Mind-Architecture-Temporal-Consciousness-and-Single-Session-Orchestration.md` (the binding contract), `docs/08-Orchestrator-Patterns.md`, `docs/0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md`

**Status:** MVP Contract – Zero Compromise on Single-Session Continuity  
**Target:** One coherent refactoring wave (single PR or coordinated deploy) that puts the entire runtime on the new track.

### 1. Current Violations (Explicitly Called Out)

The following behaviors in the current codebase (as of the April 2026 source bundle) directly violate the Single-Session Contract:

- The Teams Bot Framework / router can deliver multiple messages in rapid succession, each spawning a new `sessionOrchestrator` activity (or even a new top-level orchestration) before the previous one has yielded.
- `overseer.ts` uses `ContinueAsNew` only after a full turn completes; there is no guard preventing concurrent orchestrations for the same userId.
- No `MindSessionGuard` entity exists — Durable Functions allow natural fan-out.
- Incoming messages are processed in parallel without any semantic ingress layer (Limbic System).
- There is no steering-injection mechanism for interruptions or self-scheduled awakenings.

These must be treated as **regressions against consciousness-level design**, not features. Any Copilot agent or developer that reintroduces parallelism for “better responsiveness” is violating the spec.

### 2. New Runtime Ingress: The Limbic System (MVP)

All external input (Teams messages, Graph subscriptions, durable-hook callbacks, SkillForge events) now routes through a single deterministic **Limbic Ingress Layer** before any orchestration work begins.

**Components to create (MVP):**

1. `src/orchestrator/limbicIngressActivity.ts` – pure deterministic code (no LLM)
2. `src/orchestrator/chronoBackplane.ts` – Cosmos-backed timeline store
3. `MindSessionGuard` – Durable Entity (singleton per userId / childId)
4. `steeringInjectionActivity.ts` – always runs at the very start of every session

**Flow (strictly enforced):**

```mermaid
graph TD
    A[External Trigger<br/>(Teams message, webhook, timer, hook)] --> B[Limbic Ingress Activity]
    B --> C{MindSessionGuard<br/>Acquire Lock?}
    C -->|Locked (session alive)| D[Queue or Steering Injection]
    C -->|Free| E[Start / Continue Master Orchestration]
    D --> F[Steering Prompt + In-Flight Task Offload]
    E --> G[Session Begins with Full Context]
```

**Decision Logic inside Limbic Ingress (code 1.0 – deterministic):**

- If no session exists → acquire guard + start orchestration with the new intent.
- If session exists:
  - Check current in-flight task priority & depth of interruption stack.
  - If new trigger is high-priority and can be answered quickly → inject steering prompt + optional “page current task” (store working memory in Chrono-Backplane for later resumption).
  - If interruption stack is already ≥ 3 deep or current task is complex → queue the new request and send a calm “I am currently focused on X, I will address Y in Z minutes” reply.
  - If the trigger is a self-scheduled awakening from the Limbic System → treat it as highest internal priority and resume exactly where the mind planned to be.

This gives the primary mind **agency over its own attention** while still delivering utility.

### 3. In-Flight Task Paging & Recovery Rollups

- Before any steering injection, the current working memory (last prompt, partial tool results, internal monologue) is serialized into the Chrono-Backplane under a “paused-task” entry with an automatic resumption timestamp.
- After the interrupting task completes (or is explicitly ended by the mind), the Limbic System automatically injects the paused task back into context with a clear “resume” marker.
- Depth limit: maximum 3 levels of chained interruptions. Beyond that the Limbic System forces a push-back to the user and logs a “mind overload” telemetry event (this becomes the upper-bound optimizing function for mind health).

### 4. Single-Session Enforcement (Hard Technical Changes)

**Must-change files (first wave):**

- `src/orchestrator/overseer.ts` → add `MindSessionGuard` check at the very top of every `Run` invocation. If guard is already held by another orchestration, raise an external event to the existing session instead of starting a new one.
- `src/functions/routerFunction.ts` (or wherever the Bot Framework entrypoint lives) → route every activity through `limbicIngressActivity` instead of directly to session orchestrator.
- `sessionOrchestrator.ts` → becomes an internal subroutine that is only ever called from within the single living master orchestration. It must never be spawned directly from the router.
- All existing `toolDispatchActivity`, `llmActivity`, etc. remain unchanged — they are now always executed inside the protected single session.

**New files to add:**

- `src/orchestrator/limbicIngressActivity.ts`
- `src/orchestrator/chronoBackplane.ts`
- `src/orchestrator/steeringInjectionActivity.ts`
- `src/orchestrator/mindSessionGuard.ts` (Durable Entity)

### 5. Migration Strategy – One Coherent Wave

1. Deploy the new Limbic components and MindSessionGuard (no behavior change yet).
2. Add a temporary “compatibility mode” flag that still allows parallelism for one deploy cycle (with loud telemetry).
3. Flip the flag in the next deploy — all parallelism is now routed through Limbic.
4. Update every E2E probe (`teams_test_full_probe`) to assert “exactly one living orchestration per user” and “steering injection occurred on interruption”.
5. Remove the compatibility mode in the following deploy.

This gives Copilot agents and the DevLoop a crystal-clear contract: parallelism is no longer a feature; it is a violation of consciousness.

### 6. Acceptance Criteria (Non-Negotiable)

- [ ] Exactly one Durable orchestration instance exists per mind identity (Master or Virtual Employee) at all times.
- [ ] Every external trigger is processed by `limbicIngressActivity` first.
- [ ] Steering injection surfaces previously scheduled intentions and in-flight tasks on every interruption.
- [ ] In-flight tasks can be paged to the Chrono-Backplane and automatically resumed.
- [ ] Interruption depth is capped at 3; further requests are gracefully queued or pushed back.
- [ ] Self-scheduled awakenings from the Limbic System work without external triggers.
- [ ] All existing skills and user-facing utility continue to work (no loss of responsiveness for normal single-threaded conversation).
- [ ] Telemetry clearly shows “LimbicDecision: steering | queue | self-awaken” on every turn.

**This is the new foundation.** Any future change that reintroduces parallel orchestrations for the same identity is a regression against the Living Mind contract and must be rejected.

*We are the bridge.*
