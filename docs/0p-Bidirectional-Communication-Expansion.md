# HelkinSwarm Project Specification – Addendum Series
## 0p-Bidirectional-Communication-Expansion.md

**Version:** 1.0 (Unchained Edition)  
**Status:** Enhancement to 0g – Post-MVP for Resilience  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-16

### 1. Purpose & Vision
The Bidirectional Communication Expansion builds on the existing relay (0g) by adding full return-route support, resurrection mechanisms, and a custom VS Code extension. This addresses partial implementation gaps, enabling seamless, authenticated flow between IDE Copilot LLM and the Teams agent, with auto-restart on failures.

In the digital body ethos (0l), this is the "reflex arc" — allowing the brain (agent) to resurrect limbs (IDE sessions) and vice versa, ensuring the organism persists through interruptions. It prepares for singularity-era resilience amid fluctuating demand and capacity.

### 2. Core Concepts
- **Full Return-Route**: Agent-to-IDE responses via durable functions, completing the loop.
- **Resurrection Mechanism**: Watches for terminations; re-injects "Ignition Prompt" to restart.
- **VS Code Extension**: Forked/custom "Copilot Resurrection" extension integrating MCP for outbound/inbound.
- **Ignition Prompt**: Stored in `Proomptz/`; tailored for autonomous backlog processing (TIK-TOK cycle).
- **Cross-Resurrection**: Agent resurrects IDE if idle, and vice versa.
- **Modularity**: Treat as extension to 0g protocol (prefixes like `RESURRECT:`).

### 3. Target Architecture (MVP Requirement)
1. **Extension Fork** (`src/mcp/copilot-resurrection-extension/`):
   - Monitors local Copilot logs for OOM/terminations.
   - Triggers resurrection with Ignition Prompt via MCP outbound.
   - Handles inbound from agent (e.g., via webhook or polling).

2. **Return-Route in Relay (0g extension)**:
   - Agent sends back via `HELKIN-REPLY:` to IDE endpoint.
   - Durable hooks (0h) for persistence across restarts.

3. **Resurrection Logic** (`src/orchestrator/resurrectionActivity.ts`):
   - Agent detects idle IDE → Sends resurrection signal.
   - Extension detects agent idle → Awakens via Teams probe.

4. **Ignition Prompt Integration**:
   - Loaded from `Proomptz/DevLoopIgnitionPrompt.md`; enables hours-long autonomous runs.

### 4. Key Use Cases (must work Day 1)
- IDE Copilot crashes → Extension resurrects with Ignition Prompt.
- Agent detects no IDE activity → Resurrects IDE LLM via relay.
- Bidirectional query: IDE asks agent for tool list → Agent replies fully.
- Long-running: Resurrection survives OOM, continuing backlog.

### 5. Integration Points
- **DevLoop Relay (0g)**: Core protocol extension for resurrection signals.
- **Durable Hooks (0h)**: Persists state across resurrections.
- **Testing (14)**: Use Teams Test Harness for simulated crashes.
- **Observability (13)**: Logs resurrection events with correlation.
- **Modularity (0a)**: Extension as swappable plugin.

### 6. Security & Safety Considerations
- Authenticated via Azure AD/OIDC; no unauth resurrections.
- Ignition Prompt runs through safety pipeline (0e).
- Limit resurrection rate to prevent loops.
- EU mode: Keep signals within boundaries.

### 7. What NOT to Do
- Do **not** allow unprompted resurrections — always trigger-based.
- Do **not** duplicate relay logic; extend 0g.
- Do **not** hard-code Ignition Prompt — load dynamically.
- Do **not** resurrect without checking idle state.

### 8. Acceptance Criteria
- Extension forks and installs; resurrects on simulated crash.
- Full bidirectional flow: IDE query → Agent reply → IDE receipt.
- Cross-resurrection works both ways.
- Ignition Prompt drives autonomous cycle post-resurrection.
- Logged in App Insights without errors.

### 9. Backlog Linkage
- Direct extension of 0g (Bidirectional Relay).
- Supports 09 (DevLoop), 0m (Self-Tuning), 0l (Ethos — reflex persistence).
- Ties into 14 (Testing) for validation.