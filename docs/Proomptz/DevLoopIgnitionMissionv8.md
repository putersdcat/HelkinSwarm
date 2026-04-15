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

**One non-negotiable:** The keyword-scorer fork in `sessionOrchestrator.ts` lines 726-968 must be deleted before this epic closes. Everything else flows from that.

## Delivery Order

Work issues in this exact order. Skip only if genuinely blocked by an upstream dependency not yet shipped — document the block on the issue.

| # | Issue | Status | Why this order |
|---|-------|--------|----------------|
| 1 | **#658** | ✅ CLOSED | Persona unification — zero code risk, unlocks correct prompting for all downstream work |
| 2 | **#662** | ✅ CLOSED | Scoped token parity for workers — security gap, self-contained, no dependencies |
| 3 | **#659** | ✅ CLOSED | Persistent session chains for Harper/Benjamin/Lucas — foundational for memory + chatroom |
| 4 | **#663** | ✅ CLOSED | Per-agent RAG memory vaults — depends on #659 agentId concept |
| 5 | **#661** | ✅ CLOSED | Chatroom routing to persistent sessions — depends on #659 |
| 6 | **#657** | ✅ CLOSED | Remove keyword-scorer fork + add `activate_swarm` tool — largest change, needs stable persona + sessions |
| 7 | **#660** | ⏳ OPEN | Limbic BRB protocol — can land any time after #657 removes the fork |

**Epic #656 status: 6/7 closed. #660 is the last remaining issue.**

## Key Files

| File | Relevance |
|------|-----------|
| `src/persona/helkinPersona.md` | **Active orchestrator persona** — loaded by `buildPromptActivity.ts` for every Helkin LLM call |
| `src/persona/dronePersona.md` | Canonical drone identity reserve (mirrors `helkinPersona.md`) |
| `src/persona/agentOnePersona.md` | **Swarm-mode Helkin leader** — loaded by `swarmPersonas.buildLeaderSystemPrompt()` via `HelkinLeader` key |
| `src/orchestrator/buildPromptActivity.ts` lines 66, 83 | Loads `helkinPersona.md` for all Helkin turns |
| `src/orchestrator/swarm/swarmPersonas.ts` lines 16-32 | Loads `agentOnePersona.md` for swarm leader; falls back to `helkinPersona.md` |
| `src/orchestrator/sessionOrchestrator.ts` | Fork removed in #657; `activate_swarm` detection block at ~line 1220 |
| `src/orchestrator/swarm/swarmOrchestrator.ts` | No `waitForExternalEvent` — needs BRB gate (#660) |
| `src/orchestrator/swarm/swarmWorkerActivity.ts` `executeToolCall()` lines 143-180 | Scoped token parity done in #662 |
| `src/orchestrator/toolDispatchActivity.ts` lines 132-149 | Scoped token pattern (reference) |
| `src/orchestrator/swarm/swarmMemoryCommitActivity.ts` | Per-agent vault writes done in #663 |
| `src/memory/memoryManager.ts` | AgentId scoping done in #663 |
| `src/orchestrator/swarm/swarmChatroomEntity.ts` | Chatroom routing done in #661 |

## Stop-Loss Rules

- One issue at a time.
- Default zero new issues per run.
- If a run would end net-positive in open issues, stop and re-anchor.
- Do not let scope creep turn a file rename into an architecture rewrite.

## End Condition

**Epic #656 is 6/7 closed.** Only #660 (Limbic BRB protocol) remains.

Loop until you close #660 honestly or hit stop-loss. After #660 closes, the epic is complete.

### Beyond #656

After closing #660, check the campaign control surface for the next campaign to anchor to. Potential follow-on campaigns:
- **Enterprise Readiness Campaign** — Zone B default after #656
- **Trust Recovery Campaign** — Zone A default
- Check `gh milestone list` and open issues for the current priority
