# HelkinSwarm Project Specification – Addendum Series
## 0zl. Swarm Implementation Roadmap and Remaining Gaps

**Version:** 2.0 (Post gold-standard alignment)
**Status:** Execution Plan – Honest gap list after the 0zf\u20130zk refresh
**Owner:** Principal Developer
**Last Updated:** 2026-04-16

### 0. Scope reset

The previous revision of this doc optimistically said the design was
"complete and consistent". The gold-standard replication package at
`docs/master-azure-grok-swarm-replication-package/` made that claim
stale by raising the technical bar on several layers. This revision is
the **honest post-alignment gap list**, plus a pointer to what is and
is not yet wired in code.

This doc is deliberately **not** a code-implementation claim. Per
`.github/copilot-instructions.md` anti-optimism directive, nothing
below asserts that a capability is wired unless verified in source.

### 1. Canonical alignment status (documentation)

| Target doc | Native-vs-Helkin callout added | Canonical JSON / shard added | Enterprise refinements explicit |
|---|---|---|---|
| 0zf | Yes (\u00a70) | N/A | Yes (dynamic N-agent vs fixed quartet) |
| 0zg | Yes (\u00a70) | Yes (canonical tool schema, JSON payload \u00a75.5, injection semantics \u00a75.4) | Yes (per-agent schemas, Durable Entity transport) |
| 0zh | Yes (\u00a70) | Yes (Helkin leader prompt, messaging shard \u00a73.2, reasoning shard \u00a73.3, User Info shard \u00a73.4) | Yes (Helkin rename; Foundry tool-call format delta) |
| 0zi | Yes (\u00a70) | Yes (conversation_search \u2192 swarm_conversation_search, Leader-only commit, all-agents-same-model) | Yes (Cosmos + DiskANN mapping) |
| 0zj | Yes (\u00a70) | Yes (canonical Python 3.12.3 library list, invocation patterns) | Yes (Path A demoted, Path B required) |
| 0zk | Yes (\u00a70) | Yes (sub_session_request as HelkinSwarm-specific messageType extension) | Yes (least-privilege boundary added on top of native isolation) |
| 0zl | This doc | N/A | Honest gap list |
| 0zm | Yes (\u00a70) | Yes (retroactive-escalation mapped to native \u201cleader decides in first inference turn\u201d) | Yes (Phase 1 shipped, Phase 2 target documented) |

### 2. Real remaining implementation gaps (code)

Prioritized. Every item below must be verified in source before closure;
this doc does not claim any of it is wired.

| Priority | Gap | Spec ref | Notes |
|----------|-----|----------|-------|
| 1 | Python 3.12.3 `code_execution` sandbox with the canonical library list (Path B) | 0zj \u00a72\u20133 | Path A (JS math.js) is explicitly not canonical. |
| 2 | `chatroom_send` entity: canonical JSON payload convention on the wire (0zg \u00a75.5), mandatory messaging shard baked into every swarm agent prompt | 0zg \u00a70.1, 0zh \u00a73.2 | Without the shard, agents will not reliably emit `confidence` / `messageType`. |
| 3 | Per-agent differentiated `chatroom_send` schemas (to-enum excludes self) | 0zg \u00a70.2 | Enterprise refinement over native; strict improvement. |
| 4 | Tool-result injection semantics: "append to first tool result that returns" for in-flight parallel tool calls | 0zg \u00a75.4 | Must not duplicate, must not interrupt. |
| 5 | User Info + Current time shard re-injection every turn | 0zh \u00a73.4 | Native invariant; correctness-critical for time-sensitive queries. |
| 6 | `swarm_conversation_search` tool bound to `MemoryManager.recall()` | 0zi \u00a75.3 | Pure-cosine ranking, `source: "swarm"` metadata filter. |
| 7 | `swarm_wait` tool mapped to Durable `waitForExternalEvent` | 0zi \u00a78 | Synchronization primitive. |
| 8 | Leader-only commit activity: `swarmMemoryCommitActivity` | 0zi \u00a76.3 | Workers must not be able to write T3. |
| 9 | `sub_session_request` messageType routing in Helkin\u2019s synthesis loop | 0zk \u00a74 | Bridges swarm agents to the existing scoped-token minter. |
| 10 | Render Components strip-on-inbound / parse-on-final-only enforcement | 0zh \u00a70, master package \u00a77 | Leader-only invariant. |
| 11 | Canonical reasoning shard baked into every swarm agent prompt | 0zh \u00a73.3 | Pure prompt engineering; no runtime tool. |
| 12 | Swarm telemetry: chatroom transcript, per-agent token spend, confidence-weighted synthesis signals | 0zg \u00a79, 0zi \u00a710.5 | Feeds the 0m self-tuning loop. |
| 13 | Phase 2 planner \u2192 unified orchestrator with retroactive swarm escalation | 0zm \u00a73 | Requires cost-guardrail work (#647) first. |

### 3. Known honest constraints

- **Leader identity is `Helkin`, not `Grok`.** This is a deliberate
  HelkinSwarm divergence. All canonical leader semantics are preserved;
  only the name changes. Any contributor who sees "Grok" in a local
  spec doc should treat it as a bug to be fixed against this roadmap.
- **Tool-calling format is Foundry JSON, not canonical plain-text XML.**
  This is the single most visible prompt-level divergence. It is
  accepted because Foundry handles parallel tool dispatch natively and
  `foundryClient.ts` is the single API abstraction.
- **Swarm is an opt-in path, not the default.** Simple queries continue
  to use the existing sequential sub-agent path with zero swarm
  overhead (0zf \u00a74.4). Native swarms are effectively always-on; this
  is an intentional HelkinSwarm cost control.

### 4. What this doc will not do

- It will **not** claim any code is already wired.
- It will **not** schedule effort in calendar time.
- It will **not** merge roadmap items with the unified backlog in
  GitHub \u2014 GitHub Issues remain the single source of truth for work
  tracking per `.github/copilot-instructions.md`.

*We are the bridge.*