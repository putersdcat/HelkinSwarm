Harden, debug, and extend the swarm — then fix product-honesty bugs.

Use this prompt as an actual loop starter. Keep it short, repeatable, and outcome-driven.

## Anchor

Use **`#631`** as the program board. Swarm work lives under this epic. Non-swarm bugs (#641) are standalone.

Default bias:

- close nearly-done issues first (quick wins)
- fix product-honesty bugs before new features
- harden swarm reliability before adding new capabilities
- ship observability and UX improvements
- do not start heavy architecture work (streaming, Python sandbox, sub-session handoff) until the foundation is solid

## Context — Why v7 (Updated)

The v6 loop exhausted all standard backlog lanes. v7 Loop 1 shipped two observability wins:
- **#636** CLOSED — Per-agent cost/duration breakdown in swarm footer
- **#634** CLOSED — Progress surfacing (ack message + per-worker completion)

The swarm architecture (#631) is functionally complete (Phase S0-S2 shipped) with progress surfacing and per-agent telemetry now live. Remaining work falls into three tiers:

**Tier 1 — Quick closes & bugs (do first):**
Issues where code is already written or the fix is small and isolated.

**Tier 2 — Medium lifts (core quality):**
Hardening, observability UI, decomposer tuning — things that make the existing swarm better.

**Tier 3 — Heavy architecture (do last):**
Streaming, Python sandbox, sub-session security handoff — new capabilities that require design + infra.

## Target issues (in priority order)

### Tier 1 — Quick Closes & Bugs

| Issue | Title | Why this order | Key files |
|-------|-------|----------------|-----------|
| **#633** | Phase S1 — Memory integration | **Most ACs already met in code.** `conversation_search` handler exists (`skills/core/handlers.ts:1124`), `swarmMemoryCommitActivity.ts` exists with leader-only T3 write + heuristic selection, `swarmCost` populated in orchestrator. Needs: verify ACs, mark checkboxes, test, close. | `skills/core/handlers.ts`, `src/orchestrator/swarm/swarmMemoryCommitActivity.ts`, `src/orchestrator/swarm/swarmOrchestrator.ts` |
| **#641** | Bug: X/Twitter skill marked operational despite missing credentials | Product-honesty bug. `skillOperationalState.ts` doesn't handle `operator/backend-config-required` as non-operational. Fix is surgical. | `src/capabilities/skillOperationalState.ts`, `skills/x/manifest.json` |

### Tier 2 — Medium Lifts

| Issue | Title | Why this order | Key files |
|-------|-------|----------------|-----------|
| **#632** | Phase S0.5 — Swarm hardening | Foundational quality — env determinism, decomposer tuning, worker reliability. Several ACs overlap with work already done (#636 footer). | `src/orchestrator/sessionOrchestrator.ts`, `src/orchestrator/swarm/swarmDecomposerActivity.ts`, `src/orchestrator/swarm/swarmWorkerActivity.ts` |
| **#635** | Control Center sub-tab — Swarm Activity viewer | Medium lift. Needs new API endpoint(s) + tab JS + data persistence for swarm history. | `tabs/app.js`, `src/functions/` (new endpoint), `src/orchestrator/swarm/swarmChatroomEntity.ts` |

### Tier 3 — Heavy Architecture (park until Tier 1-2 clear)

| Issue | Title | Notes |
|-------|-------|-------|
| **#640** | Decomposer → Planner integration + complexity gate | Design-heavy. Improves swarm activation quality. |
| **#638** | Swarm → sub-session handoff for elevated-permission tool calls | Security-critical seam. New activity + chatroom message type. |
| **#637** | LLM streaming support for swarm agents | Largest lift. Touches FoundryClient core. |
| **#639** | Python REPL sandbox for Lucas persona | Infra work (Container Apps). Has dual-sandbox handoff design requirement. |

## Swarm agent persona files

Four canonical persona markdown files live under `src/persona/`:

| File | Agent | Role |
|------|-------|------|
| `src/persona/agentOnePersona.md` | Helkin (Leader) | Team coordinator & final synthesizer |
| `src/persona/agentTwoPersona.md` | Benjamin | Research & verification specialist |
| `src/persona/agentThreePersona.md` | Harper | Tool orchestration & deep browsing |
| `src/persona/agentFourPersona.md` | Lucas | Data synthesis & alternatives |
| `src/persona/dronePersona.md` | HelkinSwarm | Single-agent (non-swarm) turns |

**Known gap:** `buildWorkerSystemPrompt()` in `swarmPersonas.ts` uses generic templates. It does NOT read these persona files. The `input.agentPersona` field from the decomposer is accepted but never injected into the system prompt. Wiring the persona files into the swarm execution path is a future task (tracked conceptually under #632 decomposer tuning).

## Start-of-run checklist

1. Read `#631` and its latest comments.
2. Read the target issue fully (start with first unfinished in priority order).
3. Read the affected files before editing (see "Key files" column in each tier).
4. Check existing tests for the file you're modifying.
5. Pull the open issue list and check #631 sub-issues for latest state.

## Selection rules

- Work issues **in the tier order** (Tier 1 → Tier 2 → Tier 3).
- Within a tier, work **in the order listed**.
- If an issue is partially done from a previous run, continue where it left off.
- Only skip an issue if it's genuinely blocked by something not yet shipped.
- One issue at a time. Finish or hit stop-loss before moving to the next.

## Stop-loss rules

- One seam, one active issue.
- Default zero new issues (the planning issues are already created).
- Max one new issue per run (only for genuine discovered gaps).
- Max two shipped slices on the same issue per run.
- If the run would end net-positive in open issues, stop and re-anchor.
- Do not let scope creep turn a bug fix into an architecture rewrite.

## Delivery loop

1. Choose the next target issue from the priority list.
2. Read the full issue and comments.
3. Read the full code path before editing.
4. Implement the smallest honest slice.
5. Write or update tests for the change.
6. Validate locally: `pnpm lint && pnpm build && pnpm test`.
7. Commit and push: `feat(#NNN): description` or `fix(#NNN): description`.
8. Wait for deploy.
9. If the change affects user-facing output (footer, messages): validate live with the Teams harness.
10. Update the issue with a proof bundle (test output, build output, live evidence if applicable).
11. Close only with honest evidence that acceptance criteria are met.
12. If stop-loss triggers, quarantine the seam and go back to issue selection.

## Graph refresh discipline

After committing code changes, update the knowledge graph so it reflects the current codebase.

**When to run:** After any commit that adds, removes, or modifies files in `src/`, `skills/`, `tests/`, or `tabs/`.
**When to skip:** Config-only changes, doc-only changes, agent def changes.

#### Quick path

`/graphify . --update`

## Key files to know

| File | Purpose |
|------|---------|
| `src/orchestrator/turnTelemetry.ts` | Debug footer formatting + cost estimation |
| `src/orchestrator/swarm/swarmOrchestrator.ts` | Fan-out/fan-in sub-orchestrator |
| `src/orchestrator/swarm/swarmWorkerActivity.ts` | Per-agent multi-turn tool loop |
| `src/orchestrator/swarm/swarmLeaderActivity.ts` | Leader synthesis from transcript |
| `src/orchestrator/swarm/swarmChatroomEntity.ts` | Durable Entity for agent messaging |
| `src/orchestrator/swarm/swarmTypes.ts` | Zod schemas, SwarmPlan, SwarmCost |
| `src/orchestrator/swarm/swarmPersonas.ts` | System prompt builders (Leader + Worker) |
| `src/orchestrator/swarm/swarmMemoryCommitActivity.ts` | Leader-only T3 memory commit |
| `src/orchestrator/swarm/swarmDecomposerActivity.ts` | LLM-driven task decomposition |
| `src/orchestrator/sessionOrchestrator.ts` | Swarm routing branch (~L736-880) |
| `src/llm/foundryClient.ts` | LLM client (currently `stream: false`) |
| `src/capabilities/skillOperationalState.ts` | Skill readiness classifier (#641) |
| `src/persona/agentOnePersona.md` – `agentFourPersona.md` | Swarm agent personas |
| `tabs/app.js` | Control Center SPA |
| `skills/core/handlers.ts` | Core tool handlers incl. `conversation_search` |

## Open issue census (as of v7 update)

**Total open: ~48** | Swarm-related: 7 open | Bugs: 1 | Recurring/never-close: 4

### Swarm track (#631 sub-issues)
- ✅ #634 CLOSED — Progress surfacing
- ✅ #636 CLOSED — Per-agent footer breakdown
- 🔲 #632 OPEN — Swarm hardening (S0.5)
- 🔲 #633 OPEN — Memory integration (S1) — **most ACs already met in code**
- 🔲 #635 OPEN — Control Center sub-tab (S3)
- 🔲 #637 OPEN — LLM streaming (S3)
- 🔲 #638 OPEN — Sub-session handoff (0zk)
- 🔲 #639 OPEN — Python REPL sandbox (0zj)
- 🔲 #640 OPEN — Decomposer-planner integration (0zl)

### Bugs
- 🐛 #641 OPEN — X/Twitter skill honesty bug

### Other notable open
- #609 — Post-#494 MVP Acceleration epic (parent for non-swarm backlog)
- #507 — Auto-tuning & evaluation loop epic
- #448 — McpForge + MCP Registry integration epic
- #472 — M365 operational admin sub-epic

## End condition

Keep looping until you either:

- close the current issue honestly,
- hit a stop-loss rule and re-anchor,
- or finish the current slice and continue with the next issue in priority order.

When one issue is done, **loop again from the start-of-run checklist** and keep advancing through the tiers.
