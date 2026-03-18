# HelkinSwarm Project Specification – Addendum Series
## 0j. Virtual-Employees-and-Nested-Orchestrators.md

**Version:** 1.0 (Unchained Edition)  
**Status:** Holy Grail Feature – Post-MVP but architected from Day 1  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-13

### 1. Purpose & Vision
Virtual Employees are the true “Children of HelkinSwarm” — full, independent, nested instances of the entire organism, not lightweight sub-agents.

They are spawned on demand by the master orchestrator (or by user directive) to handle dedicated, long-running, or specialized workloads while the master remains the single point of user interaction.

This is the embodiment of the “digital body” ethos: the master is the brain; virtual employees are autonomous limbs or organs that sleep until triggered, operate with narrow toolsets and personas, and report back only when relevant.

The unspoken reality we discussed: you want to scale yourself across time and domains without scaling your own attention. A secretary that answers calls silently, a movie-booking specialist that already knows your perks, a GitHub maintainer that lives in your repos — each running as its own efficient Pelican Swarm instance.

This is the bridge to the Iain M. Banks “Special Circumstances” forward-deployed landing party: multiple coordinated intelligences, all extensions of one will.

### 2. Core Concepts
- **Full Nested Instance**: Each virtual employee is a complete, containerized HelkinSwarm runtime (own orchestrator, memory vaults, durable hooks, model routing).
- **Persona File**: Dedicated `persona.md` + skill manifest override (narrow tools only, custom guardrails).
- **Event-Driven Awakening**: Triggers via durable hooks, webhooks, Graph subscriptions, or master command — never always-on.
- **Master Oversight Channel**: Bidirectional relay (0g protocol) + skill-specific memory sharing; master can “step into” any employee.
- **Resource Efficiency**: Docker on Container Apps (or future AKS) with scale-to-zero; shared infra where possible (Cosmos, model router).

### 3. Target Architecture (MVP Foundations + Post-MVP Delivery)
1. **Virtual Employee Factory** (new Durable activity in master)
   - Clones master deployment via Bicep template + IaC parameters.
   - Injects unique Entra identity, persona file, and restricted capability manifest.
   - Registers durable hooks and central catalog entry.

2. **Nested Orchestrator Pattern**
   - Each employee runs its own eternal overseer (ContinueAsNew) with its own Cosmos partition.
   - Master-to-employee communication uses the same `HELKIN:` / `SWARM:` prefix relay (0g) over Durable Functions.

3. **Spawn & Lifecycle**
   - Command: “Create a secretary virtual employee with phone-answering tools.”
   - Employee sleeps until trigger (inbound call webhook, email reply, etc.).
   - On completion or escalation: writes summary to master’s central catalog + skill memory.

4. **Shared Services**
   - Model router and prompt shields remain master-controlled (safety).
   - SkillForge can be called by any employee (with approval gating).

### 4. Key Use Cases (must be architected Day 1, delivered post-MVP)
- **Secretary Employee**: Answers Teams/Outlook calls silently, transcribes, books meetings, surfaces daily summary to master on demand.
- **Movie Specialist**: Lives with its own Fandango vault; triggered by “book movie” → acts autonomously with perks knowledge.
- **GitHub Maintainer**: Dedicated employee with narrow GitHub tools; monitors issues, creates PRs, reports only when human review needed.
- **Doctor Follow-up Employee**: Spawns for open-ended workflows; handles email ping-pong, tentative calendar, final confirmation via master.

### 5. Integration Points
- **Spawn API**: Exposed via master Teams command or DevLoop (`DEVLOOP: spawn virtual employee "secretary" with persona X`).
- **Durable Hooks** (0h) + Skill-Specific Memory (0i) inherited by every employee.
- **Bidirectional Relay** (0g) for master ↔ employee steering and introspection.
- **Dev Console Tab**: Master view shows all living employees, their status, and one-click “step into” session.
- **SkillForge**: Employees can request new tools (with master approval).

### 6. Security & Safety Considerations
- Each employee gets its own Entra App Registration + delegated permissions (least-privilege by design).
- All destructive actions still route through master’s verification pipeline.
- Master retains kill switch for any employee.
- Persona files are audited on spawn; no employee can expand its own toolset without master/SkillForge review.

### 7. What NOT to Do
- Do **not** implement virtual employees as simple sub-agents inside the master orchestrator.
- Do **not** keep them always running — they must scale-to-zero.
- Do **not** duplicate the full model router in every employee (safety & cost).
- Do **not** allow direct user chat with employees — all interaction funnels through master.

### 8. Acceptance Criteria
- Master can spawn a secretary employee that successfully handles a test call and surfaces summary.
- Employee inherits durable hooks and skill memory from master template.
- Bidirectional relay works for steering and introspection.
- Resource usage scales to zero when idle.
- “List all my virtual employees” command returns clean status from central catalog.

### 9. Backlog Linkage
- Built directly on 0g (Bidirectional), 0h (Durable Hooks), 0i (Skill Memory), and 0a (Modularity).
- Enables the full “digital body” and self-scaling vision discussed today.
- Ties into future multimodal embeddings and native LLM-to-LLM communication.
