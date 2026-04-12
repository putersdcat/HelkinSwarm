# Swarm Build Plan — Phase S0

## Files to Create (in order)

1. `src/orchestrator/swarm/swarmTypes.ts` — Zod schemas + shared types
2. `src/orchestrator/swarm/swarmChatroomEntity.ts` — Durable Entity
3. `src/orchestrator/swarm/swarmPersonas.ts` — Agent persona templates
4. `src/orchestrator/swarm/swarmDecomposerActivity.ts` — Decomposer LLM call
5. `src/orchestrator/swarm/swarmWorkerActivity.ts` — Multi-turn worker loop
6. `src/orchestrator/swarm/swarmLeaderActivity.ts` — Opportunistic leader
7. `src/orchestrator/swarm/swarmOrchestrator.ts` — Fan-out/fan-in sub-orch
8. Update `skills/core/manifest.json` — Add chatroom_send + wait tools
9. Update `skills/core/handlers.ts` — Add virtual handlers
10. Update `src/functions/index.ts` — Register all swarm activities
11. Update `src/orchestrator/planActivity.ts` — Add swarm-eligible classification
12. Update `src/orchestrator/sessionOrchestrator.ts` — Add swarm branch

## Key Patterns to Follow
- Activities: `df.app.activity('name', { handler: async (input) => result })`
- Entities: `df.app.entity('Name', (ctx) => { ... })`
- Orchestrators: `df.app.orchestration('name', function* (context) { ... })`
- All imports use `.js` extension
- Zod for all external data shapes
- FoundryClient for LLM calls
- toolRegistry + getHandler for tool dispatch
- Named exports, no defaults

## Integration Points
- sessionOrchestrator.ts ~line 280: after plan result, check swarm-eligible
- planActivity.ts: add 'swarm-eligible' complexity classification
- index.ts: import all new swarm/* files
