### 03-Open-Workstreams-Snapshot.md

**Open Workstreams Snapshot – 2026-04-02**

**Active / High-Priority Workstreams (ranked by urgency)**

1. **Honesty & Execution-Proof Layer** (Critical – #483, #484, #485)
   - Skill operational state modelling (loaded/installed vs actually working)
   - Follow-up skill verification drift (discovery prose instead of tool execution)
   - Readiness UX and status badges in Skills Library
   - **Status**: Highest priority debt. Recent MCP skill additions have made this gap more visible.

2. **M365 Operational Admin Slice** (#472 sub-epic)
   - Employee provisioning + licensing
   - Mailbox lifecycle (users + shared)
   - Exchange Online mail routing (accepted domains, connectors, transport rules)
   - Post-provision readiness / eventual consistency checks
   - **Status**: Actively being designed; first slices expected soon.

3. **MCP Skill Ecosystem Maturation**
   - Azure MCP, Graph Enterprise MCP, Microsoft Learn MCP (all landed in last 48h)
   - Manifest traceability, update monitoring, and post-provision checks
   - Capability-group discovery + follow-up injection improvements
   - **Status**: Rapid progress, but needs stabilization.

4. **Core Orchestrator & Continuity**
   - Quoted/follow-up continuity improvements
   - Deterministic exact-tool routing on all lanes
   - Sub-agent + executor pattern hardening
   - **Status**: Mostly healthy, minor drift remains in some discovery paths.

5. **Self-Improvement & DevLoop**
   - Model-specific tool presentation tuning
   - Bidirectional DevLoop relay
   - Monte-Carlo benchmarking loop
   - **Status**: Functional but not yet fully leveraged for automated tuning.

**Lower-Priority / Future Workstreams**
- Virtual Employees / nested orchestrators
- Hydra-Net multimodal injection polishing
- BYOK external LLM support
- Full tab infrastructure & Dev Console

**Current Backlog Health**
- 483 total issues
- Recent burst of MCP-related delivery
- Dominant theme in open issues: **honesty, operational state, and execution reliability** at the product edge

**Recommendation**
Focus the next 7–10 days on the Honesty & Execution-Proof Layer (workstream #1) before resuming heavy MCP/M365 feature work. This will prevent compounding user-facing confusion as new capabilities are added.
