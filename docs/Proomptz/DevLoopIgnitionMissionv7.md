Make the swarm observable, responsive, and cost-transparent.

Use this prompt as an actual loop starter. Keep it short, repeatable, and outcome-driven.

## Anchor

Use **`#631`** as the program board. All work in this prompt lives under the Intra-Session Agent Swarm epic.

Default bias:

- ship swarm observability and UX improvements
- make the multi-agent experience visible, responsive, and debuggable

## Context — Why v7

The v6 loop exhausted all standard backlog lanes. The remaining open issues are heavy epics, external-API-gated, or downstream virtual employee work. Meanwhile the swarm architecture (#631) is functionally complete (Phase S0-S2 shipped) but operates as a black box:

- No progress messages during 30-120s swarm execution
- No Control Center visibility into swarm turns
- No per-agent cost breakdown in the debug footer
- No streaming (all LLM calls use `stream: false`)
- Chatroom transcript is ephemeral (lost when Durable Entity expires)

This prompt targets **Phase S3 — Self-Tuning and Observability** from the epic.

## Target issues (in priority order)

| Issue | Title | Why this order |
|-------|-------|----------------|
| **#636** | Swarm telemetry footer — per-agent cost breakdown | Smallest, highest signal. Pure TypeScript, no infra. |
| **#634** | Swarm progress surfacing — typing + status messages | User-facing UX win. Uses existing `sendReplyActivity` pattern. |
| **#635** | Control Center sub-tab — Swarm Activity viewer | Medium lift. Needs new API endpoint(s) + tab JS + data persistence. |
| **#637** | LLM streaming support for swarm agents | Largest lift. Touches FoundryClient, worker activity, leader activity. |

## Start-of-run checklist

1. Read `#631` and its latest comments.
2. Read the target issue fully (start with #636, then next unfinished).
3. Read the affected files before editing:
   - For #636: `src/orchestrator/turnTelemetry.ts`, `src/orchestrator/sessionOrchestrator.ts` (swarm branch ~L726-870)
   - For #634: `src/orchestrator/swarm/swarmOrchestrator.ts`, `src/orchestrator/sessionOrchestrator.ts`
   - For #635: `tabs/app.js`, `src/functions/` (new endpoint needed), `src/orchestrator/swarm/swarmChatroomEntity.ts`
   - For #637: `src/llm/foundryClient.ts`, `src/orchestrator/swarm/swarmWorkerActivity.ts`, `src/orchestrator/swarm/swarmLeaderActivity.ts`
4. Check existing tests for the file you're modifying.
5. Pull the open issue list and check #631 sub-issues for latest state.

## Selection rules

- Work issues **in the order listed above** (#636 → #634 → #635 → #637).
- If an issue is partially done from a previous run, continue where it left off.
- Only skip an issue if it's genuinely blocked by something not yet shipped.
- One issue at a time. Finish or hit stop-loss before moving to the next.

## Stop-loss rules

- One seam, one active issue.
- Default zero new issues (the planning issues are already created).
- Max one new issue per run (only for genuine discovered gaps).
- Max two shipped slices on the same issue per run.
- If the run would end net-positive in open issues, stop and re-anchor.
- Do not let scope creep turn an observability issue into an architecture rewrite.

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
| `src/orchestrator/sessionOrchestrator.ts` | Swarm routing branch (~L726-870) |
| `src/llm/foundryClient.ts` | LLM client (currently `stream: false`) |
| `tabs/app.js` | Control Center SPA |

## End condition

Keep looping until you either:

- close the current issue honestly,
- hit a stop-loss rule and re-anchor,
- or finish the current slice and continue with the next issue in priority order.

When one issue is done, **loop again from the start-of-run checklist** and keep advancing the swarm observability track.
