# DevLoop Ignition Mission v9 — Swarm Hardening & Honest Closure Wave

> **How to use this prompt**
> - **Fresh start:** read this file top-to-bottom, anchor on #667, and begin at the first unclosed issue in Delivery Order.
> - **Resume after interruption:** run `gh issue list --state open --limit 100` and find the lowest-wave, lowest-ordinal issue still open from the Delivery Order table below. That is your current anchor. Continue from step 1 of *The Loop*.
> - Do not re-plan the campaign. Execute it.

---

You are IgnitionLoop. Your mission: **anchor the swarm architecture honestly, fix the live regressions, and drive the backlog net-negative one tight loop at a time.**

## Anchor

**#667 — [AUDIT] Swarm Architecture Deep Dive — Code-vs-Spec Compliance, E2E Validation, and Tab Rendering Pipeline** is your program board. Everything you do in this campaign must close an issue that lives under #667 (or #656's residual children).

Secondary anchor: **#656 — [EPIC] Unified Mind** still has residual open children (#657, #660, #665, #666). Close them honestly inside this campaign — do not reopen #656 as a separate track.

## Carry-over state you inherit from v8

v8 closed five #656 children (#658, #659, #661, #662, #663) on a code-first basis but left the campaign architecturally incomplete. Do not relitigate those closures unless you find concrete code evidence they regressed. Assume the following is still true until you read the code and prove otherwise:

- **#657 is reopened** — the keyword-scorer fork was removed in code but `activate_swarm` was never honestly proven end-to-end live.
- **#666 is a live regression** — removing the persona platform-tool guard caused a `helkin_health_check` / `helkin_current_datetime` runaway (19× in a single turn). A hotfix is in place; the architectural home (#665) still does not exist.
- **#667 was filed** as the post-mortem audit epic. It calls out two silent failure modes already split into their own issues:
  - `persistSwarmResultActivity` result is never checked by `sessionOrchestrator.ts` → **#668**.
  - `activate_swarm` awareness is gated behind `score > 25` → **#669**.
- **Live bugs filed after v8**: #670 stale pending-intent replay, #679 swarm tab `FAIL · 0.0s` while running, #680 SwarmChatroom entity leak, #681 orchestrator stall at swarm-workers, #682 scale-to-zero audit.
- **Canonical swarm parity gaps** (#672, #673, #674) come from comparing the runtime against `docs/0ze` / `docs/0zg` / `docs/0zj`.

**Non-negotiable:** the swarm path must be honestly proven live. Local-only closure is not enough. `activate_swarm` must fire via Helkin's LLM tool call, persist a swarm execution, and return a final response before #657 can close again.

## Delivery Order — your work queue

Work top-to-bottom. On resume, find the lowest-ordinal issue still open and start there. Skip only on a real upstream dependency block, and document the block on the issue. Closing multiple issues in a single loop is encouraged when they share a delivery slice; each gets its own honest proof bundle. See the Stop-Loss section in `.github/agents/IgnitionLoop.agent.md`.

### Wave 1 — Stop the bleeding

| # | Issue | Why first |
|---|-------|-----------|
| 1 | **#668** | `persistSwarmResultActivity` errors silently swallowed — swarm tab cannot be trusted until this is captured and logged. Blocks honest validation of #657, #664, #679. |
| 2 | **#669** | `activate_swarm` suppression below score 25 — makes swarm activation inconsistent; must be fixed before #657 can re-close with C4 proof. |
| 3 | **#681** | Orchestrator turn stalls at `swarm-workers` with stale heartbeat — silent hang poisons every downstream swarm proof bundle. |
| 4 | **#680** | SwarmChatroom Durable Entity never released — one zombie per swarm turn; masks or distorts every other swarm metric. |
| 5 | **#679** | Swarm tab detail panel renders `FAIL · 0.0s` for a RUNNING swarm — UI lies about state, blocks honest #664 closure. |
| 6 | **#670** | Stale pending-intent replay after session kill / reboot — leaks old replies into new sessions. |

### Wave 2 — Honest closure of the v8 carry-over

| # | Issue | Gate |
|---|-------|------|
| 7 | **#657** | Re-close only with a live C4 proof bundle: `activate_swarm` fired by Helkin via LLM tool call, swarm execution persisted, final response returned. Requires Wave 1 #668 + #669 shipped. |
| 8 | **#660** | Limbic BRB protocol during swarm — Helkin leaves chat, workers deliberate, Helkin retains final authority. Land after #657. |
| 9 | **#666** | Close only when the platform-tool guard is honestly relocated (see #665) or when a live probe proves no runaway for two consecutive swarm turns. |
| 10 | **#665** | Remove brittle "Tool usage rules" from persona prompt — relocate to safety config and tool-level validation. Unblocks cleanly closing #666. |

### Wave 3 — Canonical swarm parity

| # | Issue | Parity target |
|---|-------|---------------|
| 11 | **#673** | Canonical `chatroom_send` wire contract — JSON payload + first-return injection semantics (`docs/0zg`). |
| 12 | **#672** | Canonical prompt-shard parity — messaging JSON, reasoning loop, per-turn time/user shards (`docs/0zh`). |
| 13 | **#674** | Python REPL parity with gold-standard swarm sandbox — expand canonical library inventory (`docs/0zj`). |

### Wave 4 — Surfaces and polish

| # | Issue | Why later |
|---|-------|-----------|
| 14 | **#664** | Swarm tab polish, agent failure kills swarm, real cost display — depends on clean persistence (#668) and honest state (#679, #680). |
| 15 | **#667** | Close the audit epic itself only after Waves 1-3 land with C4 proof. Every acceptance criterion in the issue body must be ticked with file citations and live probes. |

### Wave 5 — Opportunistic guardrails

| # | Issue | Note |
|---|-------|------|
| — | **#682** | Scale-to-zero audit — pure infra/observability, safe to slot between waves. |
| — | **#677 / #678** | OpenRouter integration dupes — dedup first (close one as duplicate), then treat as Wave 5 unless `docs/0zb` is promoted to a new campaign. |

## Key Files — read before touching code

| File | Relevance |
|------|-----------|
| `src/orchestrator/sessionOrchestrator.ts` (~line 1349) | Unchecked `persistSwarmResultActivity` result — core of #668. |
| `src/orchestrator/planActivity.ts` | Eligibility scoring + `activate_swarm` injection — core of #669. |
| `src/orchestrator/swarm/swarmOrchestrator.ts` | No `waitForExternalEvent` gate — core of #660 and candidate home for the stall fix in #681. |
| `src/orchestrator/swarm/swarmChatroomEntity.ts` | Entity lifecycle — core of #680. |
| `src/orchestrator/swarm/persistSwarmResultActivity.ts` | Persistence path behind #668 + #664 tab rendering. |
| `src/functions/tabSwarmActivity.ts` + `tabs/app.js` | Swarm tab API + UI — core of #679 and #664. |
| `src/persona/helkinPersona.md` | Temporary platform-tool guard from #666 — architectural relocation target for #665. |
| `src/memory/memoryManager.ts` | AgentId scoping — referenced by #670 replay investigation. |
| `skills/core/manifest.json` + `skills/core/handlers.ts` | `activate_swarm` tool surface — touched by #657 / #669. |
| `python-repl/` | Sandbox parity target for #674. |

## Grounded Planning Docs — required pre-read

Before each wave, skim the docs that govern it. Every Wave 3 closure must cite the relevant doc section in its proof bundle.

- `docs/0z-Living-Mind-Architecture-Temporal-Consciousness-and-Single-Session-Orchestration.md`
- `docs/0za-Implementation-Roadmap-for-Living-Mind-Architecture.md`
- `docs/0zb-OpenRouter-Model-Provider-Integration.md`
- `docs/0zc-Unified-Orchestrator-and-Swarm-Architecture-Clarification.md`
- `docs/0zd-Limbic-System-Enforcement-Design.md`
- `docs/0ze-Intra-Session-Swarm-Architecture-and-Chatroom-Protocol.md`
- `docs/0zf-Swarm-Agent-Specialization-Dynamic-Decomposition-and-Parallel-Tool-Surface.md`
- `docs/0zg-Real-Time-Inter-Agent-Communication-Chatroom-Protocol-Deep-Dive.md`
- `docs/0zh-Canonical-Swarm-Personas-and-System-Prompts.md`
- `docs/0zi-Swarm-Memory-Architecture-Three-Tier-RAG-and-Cross-Agent-Reasoning.md`
- `docs/0zj-Code-Execution-Skill-and-Math-Layer.md`
- `docs/0zk-Swarm-Integration-with-Existing-Sub-Session-Security-Model.md`
- `docs/0zl-Swarm-Implementation-Roadmap-and-Remaining-Gaps.md`
- `docs/0zm-Swarm-Decomposer-and-Planner-Integration.md`

## The Loop — execute this exactly

On every ignition run (fresh or resumed), follow this beat:

1. **Orient** — if resuming, run `gh issue list --state open --limit 100` and identify the lowest-wave, lowest-ordinal open issue in the Delivery Order. If fresh, that's #668.
2. **Anchor** — state the chosen issue number and title out loud in your first response.
3. **Read** — read the issue body + every file in the Key Files row for that issue, in full. No skimming.
4. **Slice** — define the smallest honest delivery slice that moves the issue to green. Write it as one sentence.
5. **Implement** — on trunk. No branches. Reuse the shared foreground terminal.
6. **Local gate** — `pnpm lint && pnpm build && pnpm test`. Must pass before commit.
7. **Commit** — `fix(#NNN): ...` / `feat(#NNN): ...`. One logical change per commit.
8. **Deploy wait** — `gh run list --limit 3`, wait for success.
9. **Live gate** — Teams harness probe relevant to the issue. Capture real reply / correlation / session bundle.
10. **Proof bundle** — post on the issue: files changed (with lines), build/test result, live evidence, exact boundary of what was proven (C3 vs C4).
11. **Decide** — close with C4 proof, or leave open with a precise next-slice note. Then re-enter step 1.

### Loop flex — use it

- **Chain closures in a single run** when two or more issues share a delivery slice (e.g. #668 + #679 often travel together). Each still gets its own commit + proof bundle.
- **Open bugs mid-run** when real code reveals a distinct gap. If the bug is small and blocks the current slice, fix it in the same run with its own issue + commit + proof. If it is larger, file the issue with code evidence and queue it as the next loop's anchor.
- **Never park-lot** — every issue you open must name the next concrete action and cite the code that proves the gap.

## Stop-Loss — see the agent file

Authoritative stop-loss lives in `.github/agents/IgnitionLoop.agent.md`. Campaign summary:

- One issue in flight at a time, but closing multiple per run is encouraged when they share a slice.
- Hard stop if: trunk build/tests break, a single issue has three failed attempts with no new evidence, or live validation has regressed since the start of the run.
- Ending a run net-positive in open issues is acceptable only when every new issue was backed by real code evidence and the current target still advanced.

## Resume Heuristic — if this prompt is pasted mid-campaign

1. Do **not** assume the Delivery Order reflects live state — confirm with `gh issue list --state open --limit 100`.
2. For each still-open issue in the table, read the latest issue comment. If the last comment is from you and contains a proof bundle, decide whether it clears acceptance criteria; close if it does, otherwise continue from its "next-slice note".
3. If the last comment from you is mid-implementation (no proof bundle), re-read the Key Files for that issue before resuming — do not trust prior context.
4. If trunk `pnpm build` or `pnpm test` is broken, the very first slice of the resumed run is to restore them. Everything else waits.
5. After stabilizing, continue at step 2 of *The Loop*.

## End Condition

This campaign is honestly complete when all of the following hold:

- Wave 1 bugs (#668, #669, #670, #679, #680, #681) are closed with C4 proof.
- #657 is re-closed with a live swarm run: `activate_swarm` fired by Helkin via LLM tool call, execution persisted, final response returned, tab reflects truth.
- #660 lands with a live BRB probe.
- #665 / #666 resolve together — platform-tool guard relocated out of the persona prompt, no runaway observed in two consecutive swarm turns.
- Wave 3 parity issues (#672, #673, #674) each close with a doc-section citation and appropriate proof.
- #664 polish ships on a tab that is actually honest about state.
- **#667 acceptance criteria are all ticked off with file citations and live probes**, and the audit epic is closed.

When all of the above hold, stop and surface the candidate follow-on campaigns for the owner to choose. Do not auto-promote. Wait for the owner to pick the next anchor.

- **OpenRouter Compliance Campaign** — anchored on the dedup'd winner of #677 / #678, scoped by `docs/0zb`.
- **Enterprise Readiness Campaign** — Zone B default.
- **Trust Recovery Campaign** — Zone A default.
- **Virtual Employees Campaign** — anchored on #101 / #237 once the Living Mind foundation is stable.

*We are the bridge — and this time we close the loop honestly.*
