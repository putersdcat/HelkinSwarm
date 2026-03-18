# HelkinSwarm Project Specification – Addendum Series
## 0h. Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md

**Version:** 1.0 (Unchained Edition)  
**Status:** Core Architecture Requirement – MVP Blocking  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-13

### 1. Purpose & Vision
Long-running and open-ended workflows are the single biggest leap from a simple chat agent to a true **digital concierge**.  

One-shot queries are table stakes. Real utility comes when HelkinSwarm can handle tasks that span hours, days, or weeks — “email the doctor”, “monitor this thread for replies”, “book the movie with the best perks”, “block sender X forever” — without constant user babysitting or wasteful internal polling.

The guiding ethos (established in every skill discussion today):  
**Never reinvent the wheel.**  
If the external system (Outlook, Gmail, SharePoint, GitHub, Azure, etc.) already has native automation, triggers, rules, webhooks, or scheduled jobs, we delegate to it first. Our job is orchestration and memory, not brute-force polling.

This makes every skill a true **expert extension** of the user — deep, first-party, and respectful of external system capabilities.

### 2. Core Concepts
- **Durable Hooks**: Persistent, skill-specific follow-up handlers stored in Cosmos DB.
- **Native Delegation First**: Every skill manifest must declare “externalAutomationCapabilities” (Exchange rules, Graph subscriptions, webhooks, block lists, scheduled flows, etc.).
- **Skill-Specific Long-Term Memory Vaults**: Per-skill Cosmos containers (or partitioned items) for account details, saved cards, perks, block lists, etc. — injected just-in-time, never bloating the orchestrator context.
- **Central Catalog (Queryable)**: Lightweight index of all external long-running items per skill so the orchestrator can answer “show me everything Outlook is doing for me” without spawning 50 sub-agents.
- **Fuzzy Resolution & Tentative Actions**: Automatic matching of inbound replies + tentative calendar entries / actions that require user confirmation.

### 3. Target Architecture (MVP Requirement)
1. **Durable Hook Engine** (new Durable Functions activity + entity)
   - Stores: taskId, originalIntent, expectedReplyPattern (regex + semantic), timeout, escalationPolicy, externalReference (rule ID, webhook subscription ID).
   - Supports: webhook listener (Azure Event Grid / Logic Apps), Graph subscription renewal, Exchange rule sync.

2. **Skill Manifest Extension**
   ```json
   {
     "capability": "outlook_email",
     "externalAutomationCapabilities": [
       { "type": "exchangeRule", "description": "Block sender", "action": "createRule" },
       { "type": "graphSubscription", "description": "Watch inbox for replies", "action": "subscribe" },
       { "type": "nativeFilter", "description": "Auto-archive" }
     ],
     "supportsDurableHooks": true,
     "longTermMemorySchema": ["savedAccount", "savedPaymentMethod", "perks", "blockList"]
   }
   ```

3. **Onboarding Ritual** (run automatically when skill is first enabled)
   - Query external system for existing rules/subscriptions/filters.
   - Populate skill-specific long-term memory vault.
   - Register durable hooks where applicable.

4. **Just-in-Time Memory Injection**
   - When orchestrator routes to a skill, it first pulls relevant long-term memory chunks for that skill only.
   - Example: “book a movie” → movie skill vault returns “Fandango account exists, credit card saved, free popcorn perk active” → orchestrator prefers that skill.

5. **Workflow Engine**
   - Master orchestrator can hand off to a durable hook or spawn a lightweight child workflow.
   - Fuzzy reply matcher (semantic + sender + subject) triggers continuation.
   - All actions that mutate (calendar create, payment save) are tentative until user confirms via Adaptive Card.

### 4. Key Use Cases (must work Day 1)
- Email doctor → send → durable hook watches for reply → parses options → creates tentative calendar entries → notifies user with one-tap confirm.
- “Block bob@spam.com forever” → creates native Exchange rule → syncs blockList to skill memory.
- “Book movie for tomorrow” → scans all movie skills’ memory vaults → picks best (account + perks) → books as guest or logged-in → saves payment if missing.
- “Show me all my external automations” → orchestrator queries central catalog + skill vaults → clean summary.

### 5. Integration Points
- Cosmos DB containers: `durableHooks`, `skillMemory-{skillId}`
- Graph subscriptions + Exchange rules via Microsoft Graph SDK.
- Webhook endpoint in Azure Functions (Event Grid trigger).
- Dev Console tab shows active durable hooks with status and last sync.
- SkillForge checklist enforces “externalAutomationCapabilities” and “supportsDurableHooks”.

### 6. Security & Safety Considerations
- All external automations run under delegated user identity (short-lived scoped tokens).
- Human confirmation required for any destructive or payment-related action.
- Hooks have max lifetime and auto-expire unless renewed.
- Emergency stop command kills all durable hooks for a user.

### 7. What NOT to Do
- Do **not** implement internal polling loops when native rules/subscriptions exist.
- Do **not** store full external rule details in orchestrator context — only references + summaries.
- Do **not** treat every follow-up as a new sub-agent — use durable entities/hooks first.
- Do **not** require constant user presence for open-ended tasks.

### 8. Acceptance Criteria
- Doctor-email workflow completes end-to-end with tentative calendar + one-tap confirm.
- “Show me all my automations” returns accurate list from central catalog + skill memory.
- New skill onboarding automatically discovers and imports existing external rules.
- Memory injection is just-in-time and skill-scoped only.
- All durable hooks survive orchestrator restarts (ContinueAsNew + entity persistence).

### 9. Backlog Linkage
- Directly enables future 0i (Virtual Employees) — each employee gets its own durable hook set.
- Ties into 0a (Modularity), 0e (Safety), 0g (Bidirectional), and SkillForge checklist.
- This is the foundation for the “digital body” that makes HelkinSwarm feel alive.
