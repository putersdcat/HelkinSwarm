Unify the orchestrator and make Harper, Benjamin, and Lucas real.

## Anchor

**#656** is the program board. All work in this campaign lives under this epic.

## Context

The swarm is functional but architecturally unsound:
- Helkin never decides to enter swarm mode — a keyword scorer does it for him
- Helkin has two divergent personas depending on which code path fires
- Harper, Benjamin, and Lucas are ephemeral activities that die after every swarm
- Their research all lands in Helkin's memory vault with no per-agent partitioning
- Limbic interrupts cannot reach Helkin while he is inside a swarm
- Workers call tools directly without minting scoped tokens

Additional live regressions / proof gaps discovered after the initial closeout wave:
- #657 was **reopened** — `activate_swarm` can fire without honestly proving the durable swarm path end-to-end
- #666 is a live regression bug — removing the persona platform-tool guard caused a catastrophic `helkin_health_check` / `helkin_current_datetime` follow-up loop
- #665 remains open as the architectural follow-on — the temporary persona hotfix is in place, but the real home for those rules still needs to be built

**One non-negotiable:** the swarm path must be honestly proven live. Local-only closure is not enough. `activate_swarm` must deliver a real `🧠 Swarm engaged` ack, persist a new swarm execution, and return a final swarm response before #657 can close again.

## Delivery Order

Work issues in this exact order. Skip only if genuinely blocked by an upstream dependency not yet shipped — document the block on the issue.

| # | Issue | Status | Why this order |
|---|-------|--------|----------------|
| 1 | **#658** | ✅ CLOSED | Persona unification — zero code risk, unlocks correct prompting for all downstream work |
| 2 | **#662** | ✅ CLOSED | Scoped token parity for workers — security gap, self-contained, no dependencies |
| 3 | **#659** | ✅ CLOSED | Persistent session chains for Harper/Benjamin/Lucas — foundational for memory + chatroom |
| 4 | **#663** | ✅ CLOSED | Per-agent RAG memory vaults — depends on #659 agentId concept |
| 5 | **#661** | ✅ CLOSED | Chatroom routing to persistent sessions — depends on #659 |
| 6 | **#657** | 🔴 REOPENED | Remove keyword-scorer fork + add `activate_swarm` tool — code landed, but live proof failed; durable swarm path still not honestly proven |
| 7 | **#660** | ⏳ OPEN | Limbic BRB protocol — can land any time after #657 is honestly proven |
| 8 | **#666** | 🔥 OPEN BUG | Regression: platform-tool loop runaway after persona guard removal — hotfix landed, but keep in view until live evidence is clean |
| 9 | **#665** | ⏳ OPEN FOLLOW-ON | Relocate brittle persona tool rules into safety / dispatch architecture after the temporary hotfix |

**Epic #656 status: not honestly complete. #657 is reopened, #660 remains open, and #665/#666 are active supporting issues.**

## Key Files

| File | Relevance |
|------|-----------|
| `src/persona/helkinPersona.md` | **Active orchestrator persona** — loaded by `buildPromptActivity.ts` for every Helkin LLM call |
| `src/persona/dronePersona.md` | Canonical drone identity reserve (mirrors `helkinPersona.md`) |
| `src/persona/agentOnePersona.md` | **Swarm-mode Helkin leader** — loaded by `swarmPersonas.buildLeaderSystemPrompt()` via `HelkinLeader` key |
| `src/orchestrator/buildPromptActivity.ts` lines 66, 83 | Loads `helkinPersona.md` for all Helkin turns |
| `src/orchestrator/swarm/swarmPersonas.ts` lines 16-32 | Loads `agentOnePersona.md` for swarm leader; falls back to `helkinPersona.md` |
| `src/orchestrator/sessionOrchestrator.ts` | Fork removed in #657; `activate_swarm` detection block at ~line 1200 — but live proof gap remains |
| `src/orchestrator/swarm/swarmOrchestrator.ts` | No `waitForExternalEvent` — needs BRB gate (#660) |
| `src/orchestrator/swarm/swarmWorkerActivity.ts` `executeToolCall()` lines 143-180 | Scoped token parity done in #662 |
| `src/orchestrator/toolDispatchActivity.ts` lines 132-149 | Scoped token pattern (reference) |
| `src/orchestrator/swarm/swarmMemoryCommitActivity.ts` | Per-agent vault writes done in #663 |
| `src/memory/memoryManager.ts` | AgentId scoping done in #663 |
| `src/orchestrator/swarm/swarmChatroomEntity.ts` | Chatroom routing done in #661 |
| `src/persona/helkinPersona.md` / `src/persona/dronePersona.md` | Temporary persona guard re-added in #666 hotfix; architectural relocation tracked by #665 |

## Stop-Loss Rules

- One issue at a time.
- Default zero new issues per run.
- If a run would end net-positive in open issues, stop and re-anchor.
- Do not let scope creep turn a file rename into an architecture rewrite.

## End Condition

**Epic #656 is not yet honestly closed.** #657 is reopened and #660 remains open.

Loop until you close #657 and #660 honestly or hit stop-loss. Keep #666 / #665 visible as regression guardrails while doing so.

### Beyond #656

After closing #660, check the campaign control surface for the next campaign to anchor to. Potential follow-on campaigns:
- **Enterprise Readiness Campaign** — Zone B default after #656
- **Trust Recovery Campaign** — Zone A default
- Check `gh milestone list` and open issues for the current priority
