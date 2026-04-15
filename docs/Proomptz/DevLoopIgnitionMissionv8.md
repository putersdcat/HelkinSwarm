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

| # | Issue | Why this order |
|---|-------|----------------|
| 1 | **#658** | Persona unification — zero code risk, unlocks correct prompting for all downstream work |
| 2 | **#662** | Scoped token parity for workers — security gap, self-contained, no dependencies |
| 3 | **#659** | Persistent session chains for Harper/Benjamin/Lucas — foundational for memory + chatroom |
| 4 | **#663** | Per-agent RAG memory vaults — depends on #659 agentId concept |
| 5 | **#661** | Chatroom routing to persistent sessions — depends on #659 |
| 6 | **#657** | Remove keyword-scorer fork + add `activate_swarm` tool — largest change, needs stable persona + sessions |
| 7 | **#660** | Limbic BRB protocol — can land any time after #657 removes the fork |

## Key Files

| File | Relevance |
|------|-----------|
| `src/persona/dronePersona.md` | Solo Helkin persona (merge source) |
| `src/persona/agentOnePersona.md` | Swarm Helkin persona (merge source) |
| `src/orchestrator/buildPromptActivity.ts` lines 66, 83 | Loads dronePersona for solo path |
| `src/orchestrator/swarm/swarmPersonas.ts` lines 16-28 | Loads agentOnePersona for swarm path |
| `src/orchestrator/sessionOrchestrator.ts` lines 726-968 | **The fork — must be deleted in #657** |
| `src/orchestrator/swarm/swarmTypes.ts` lines 240-356 | Keyword scorer + complexity gate |
| `src/orchestrator/planActivity.ts` lines 191-258 | swarmEnabled/swarmEligibilityScore fields |
| `src/orchestrator/swarm/swarmWorkerActivity.ts` `executeToolCall()` lines 143-180 | Missing scopedTokenMinter |
| `src/orchestrator/toolDispatchActivity.ts` lines 132-149 | Scoped token pattern to replicate |
| `src/orchestrator/swarm/swarmMemoryCommitActivity.ts` | Writes to userId only — needs agentId |
| `src/memory/memoryManager.ts` | Needs optional agentId constructor param |
| `src/orchestrator/swarm/swarmOrchestrator.ts` | No waitForExternalEvent — needs BRB gate (#660) |

## Stop-Loss Rules

- One issue at a time.
- Default zero new issues per run.
- If a run would end net-positive in open issues, stop and re-anchor.
- Do not let scope creep turn a file rename into an architecture rewrite.

## End Condition

Loop until you close an issue honestly or hit stop-loss. Then loop again from the next issue in the delivery order.

The campaign ends when all 7 issues are closed with C4 evidence and the keyword-scorer fork is gone from the codebase.
