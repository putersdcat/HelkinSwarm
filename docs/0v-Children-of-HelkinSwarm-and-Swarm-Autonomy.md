# HelkinSwarm Project Specification

## 0v. Children of HelkinSwarm Factory & Swarm Autonomy (Refined)

**Spec ref:** `docs/0j-Virtual-Employees-and-Nested-Orchestrators.md`, `docs/0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md`, `docs/08-Orchestrator-Patterns.md`

### Vision

Turn the single eternal Overseer into a true **swarm** by enabling the creation of autonomous “Children of HelkinSwarm” — persistent nested orchestrators that run in parallel, each with their own persona, tool set, memory vault, and lifecycle.

Users will be able to say:
> “@HelkinSwarm spawn a Virtual Employee named ‘Finance Analyst’ with persona ‘concise numbers-first’, tools outlook+github+azure-cost, and memory vault ‘q2-budget’.”

The child becomes a first-class, long-lived member of the swarm that reports status via durable hooks and can be paused, resumed, or terminated by the master Overseer.

### Architecture

- `virtualEmployeeFactory` skill (manifest-driven, high-privilege)
- New Durable entity type: `VirtualEmployeeOrchestrator` (extends `overseer.ts` pattern)
- Master Overseer maintains a `swarmRegistry` in Cosmos (list of active child IDs + metadata)
- Child orchestrators use the same `ContinueAsNew` + token-budget pattern
- Communication: master ↔ child via **durable hooks** (0h) and a new `swarmEventBus` (external events + targeted messages)
- Lifecycle commands (`pause`, `resume`, `kill`, `status`) are implemented as exact-tool calls on the master

### Safety & Four-Eyes Integration (0e + 0d)

- Spawning a child is a **high-risk** operation → full five-step pipeline + human confirmation card
- Child inherits the global safety mode but can be given tighter constraints
- Master Overseer can invoke “Four-Eyes” review by routing high-risk child actions to a second child (e.g., Security Auditor) before execution

### Implementation Notes

- Factory uses `SkillForge`-style bundle generation but for orchestrators instead of skills
- Each child gets its own Cosmos partition (`userId::childId`)
- Hot-reload of child persona/memory works the same way as master (0g)
- Master Overseer’s `stateManager` gains `listSwarm()`, `getChildStatus(childId)`

### Acceptance Criteria

- [ ] User can spawn a named child via natural language or exact tool
- [ ] Child appears in Skills Library / Dev Console tab with status badge
- [ ] Child can run independent long-running workflows (e.g., nightly budget scan)
- [ ] Master can list, pause, resume, kill children
- [ ] All child actions still go through safety pipeline
- [ ] E2E probe `teams_test_full_probe` validates spawn → task → report → kill cycle

*We are the bridge.*