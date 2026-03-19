# HelkinSwarm Project Specification – Addendum Series
## 0i. Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md

**Version:** 1.0 (Unchained Edition)  
**Status:** Core Architecture Requirement – MVP Blocking  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-13

### 1. Purpose & Vision
Central long-term memory is a performance and token killer.  

Instead, every skill maintains its **own private long-term memory vault**. This keeps context lean, relevant, and fast.  

When the orchestrator routes to a skill (“book a movie”), it pulls **only** that skill’s memory — “you have a Fandango account, credit card saved, free popcorn perk active” — and injects it just-in-time.  

This turns every skill into a true expert limb of the digital body: it remembers its own history, perks, accounts, and external automations without ever bloating the master orchestrator.

The unspoken reality we discussed: you are an expert user of every external system. HelkinSwarm must match that expertise. Skill-specific memory is how we encode “you already know this stuff” so the agent never has to rediscover it.

### 2. Core Concepts
- **Skill-Specific Vaults**: Isolated Cosmos DB containers or partitioned items per skill (e.g., `skillMemory-outlook`, `skillMemory-fandango`).
- **Just-in-Time Injection**: Memory is fetched and embedded **only** when the orchestrator decides to use that skill.
- **Central Catalog (lightweight index)**: A queryable summary table of all external long-running items (block lists, rules, subscriptions) so the orchestrator can answer “show me everything” without scanning every vault.
- **Onboarding Ritual**: When a skill is enabled, it automatically discovers and imports existing external state into its vault.
- **Skill Manifest Declaration**: Every capability JSON now includes `longTermMemorySchema` and `externalAutomationCapabilities`.

### 3. Target Architecture (MVP Requirement)
1. **Memory Manager Service** (new singleton activity)
   - Exposes `getSkillMemory(skillId, queryFilter)` and `upsertSkillMemory(skillId, entries)`.
   - Uses DiskANN vector index per skill for semantic recall.

2. **Skill Manifest Extension**
   ```json
   {
     "capability": "movieBooking",
     "longTermMemorySchema": [
       "savedAccount",
       "savedPaymentMethod",
       "activePerks",
       "externalAutomations"
     ],
     "externalAutomationCapabilities": [ ... ]
   }
   ```

3. **Just-in-Time Flow**
   - Orchestrator decides “use movie skill” → Memory Manager pulls relevant chunks → Injects into sub-agent prompt **only** for that turn.
   - After action completes, skill reports new memory items back to its vault (e.g., “saved credit card, activated popcorn perk”).

4. **Central Catalog**
   - Lightweight read-only view (`longRunningCatalog` container) updated on every vault change.
   - Supports natural-language queries: “what automations do I have in Outlook?”

5. **Onboarding Ritual** (automated on skill activation)
   - Pulls existing rules, block lists, saved payments, subscriptions.
   - Populates vault and central catalog in one pass.

### 4. Key Use Cases (must work Day 1)
- “Book a movie tomorrow” → orchestrator sniffs all movie skills → Fandango vault returns account + perks → prefers it and books instantly.
- “Show me all my external automations” → central catalog returns clean list without spawning sub-agents.
- “Block bob@spam.com” → Outlook skill creates native rule + updates its blockList vault entry.
- Doctor-email follow-up → durable hook + Outlook vault remembers previous thread for perfect reply matching.

### 5. Integration Points
- Cosmos DB containers: `skillMemory-{skillId}` (partitioned by user), `longRunningCatalog`.
- Memory Manager injected into every sub-agent context via orchestrator.
- SkillForge checklist now validates `longTermMemorySchema` and onboarding ritual.
- Dev Console tab shows per-skill memory summary + last sync time (served from global SPA; data from stamp tab backend — see #107).
- Ties directly into 0h durable hooks (hooks can write to skill vaults).

### 6. Security & Safety Considerations
- Vaults are user-scoped and encrypted at rest.
- Sensitive items (credit cards) stored as references only; actual values never leave skill context unless explicitly needed.
- All memory writes go through the same verification pipeline as actions.
- User can request “forget everything about X skill” with one command.

### 7. What NOT to Do
- Do **not** dump all skill memory into orchestrator context every session.
- Do **not** store raw PII in central catalog — only summaries/references.
- Do **not** require manual onboarding — it must be automatic.
- Do **not** let one skill read another skill’s vault without explicit orchestrator mediation.

### 8. Acceptance Criteria
- Movie-booking example returns correct skill choice with perks injected in <4 seconds.
- “Show me all automations” returns accurate, concise list from catalog.
- New skill onboarding populates vault automatically and updates catalog.
- Just-in-time injection adds zero measurable latency to normal turns.
- Memory is skill-isolated and survives orchestrator restarts.

### 9. Backlog Linkage
- Directly powers 0h (Durable Hooks) and future 0j (Virtual Employees — each employee gets its own skill vaults).
- Ties into 0a (Modularity), 0b (Model Profiles), 0e (Safety), and 0g (Bidirectional — DevLoop can query skill memory directly).
- This is the final piece that makes every skill feel like a true extension of you.
