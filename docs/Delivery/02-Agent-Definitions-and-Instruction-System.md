# HelkinSwarm Unchained – Development & Delivery Plan
## 02. Agent Definitions, Instruction System & GitHub Guidance

**Version:** 1.0  
**Status:** Permanent Guidance Document  
**Purpose:** This document defines the structure, purpose, and maintenance rules for the **.github/agents/** and **.github/instructions/** folders.  

These folders and their contents **do not exist in the repository today**. They must be bootstrapped as part of early implementation (after Phase 1 or 2) following the exact guidelines below. They form the operational contract that guides all agents (human and AI) and enforces the digital-body ethos across every layer of the system.

---

### 1. Folder Structure (To Be Created)

```
.github/
├── agents/                  # Agent-specific personas and operating modes (create these files)
│   ├── AzureAgent.agent.md
│   ├── BasicBitch.agent.md
│   ├── DevLoop.agent.md
│   └── (future agents as needed)
├── instructions/            # Domain-specific rules and constraints (create these files)
│   ├── bot-framework.instructions.md
│   ├── cicd.instructions.md
│   ├── codebase-structure.instructions.md
│   ├── devloop-harness.instructions.md
│   ├── identity-auth.instructions.md
│   ├── integration-manifests.instructions.md
│   ├── llm-models.instructions.md
│   ├── mcp-skills.instructions.md
│   ├── memory-cosmos.instructions.md
│   ├── orchestrator-patterns.instructions.md
│   ├── safety-architecture.instructions.md
│   └── teams-testing.instructions.md
└── copilot-instructions.md  # Root-level Copilot rules (create this file)
```

**Rule:**  
- Agents define **who** the AI is in a given context.  
- Instructions define **how** the AI must behave in a specific domain.  
- The root `copilot-instructions.md` is the master override layer that loads first.

---

### 2. Agent Definitions (.github/agents/)

Create the following three agent files during bootstrap. Each must be a self-contained persona that can be loaded by DevLoop, SkillForge, or any external MCP server.

**Required Agents (create these):**
- **AzureAgent.agent.md** — Execution engine for infrastructure and resource management. Always uses GitOps, never manual portal actions.
- **BasicBitch.agent.md** — General-purpose iterative task executor (refactoring, bug fixes, feature implementation).
- **DevLoop.agent.md** — The IDE-side self-improvement partner. Uses the radio protocol (0g) and drives the TIK-TOK cycle.

**Future Agents** (add later as needed):  
SkillForge.agent.md, VirtualEmployee.agent.md, HydraNet.agent.md, etc.

**Maintenance Rule**  
Every agent file must reference the living specification (01–16 + 0a–0l + 0m) and the two Never-Close issues (01-Recurring-Maintenance...). Update via the recurring codebase-health pass.

---

### 3. Domain-Specific Instructions (.github/instructions/)

Create the following twelve instruction files during bootstrap. Each contains enforceable rules for a specific layer of the digital body.

**Required Instruction Files (create these):**
- bot-framework.instructions.md  
- cicd.instructions.md  
- codebase-structure.instructions.md  
- devloop-harness.instructions.md  
- identity-auth.instructions.md  
- integration-manifests.instructions.md  
- llm-models.instructions.md  
- mcp-skills.instructions.md  
- memory-cosmos.instructions.md  
- orchestrator-patterns.instructions.md  
- safety-architecture.instructions.md  
- teams-testing.instructions.md  

**Key Rules for All Instruction Files**
- Must start with a clear “Critical Rule” or “Fundamental Constraint”.
- Must include “Always” and “Never” sections.
- Must cross-reference the relevant spec section (e.g., 0e, 0h, 0i).
- Must be referenced in the DevLoop ignition prompt and the recurring maintenance issues (01).

**Maintenance Rule**  
The recurring “Codebase Health & Documentation Alignment” issue must review and update these files after every major milestone.

---

### 4. Root Copilot Instructions (copilot-instructions.md)

Create this master file during bootstrap. It contains the global rules, project identity, tech stack overview, and the “We are the bridge” ethos statement.

It must remain concise and always reference the living specification.

---

### 5. Integration with DevLoop & SkillForge

- DevLoop (0g + 0b + 0m) uses these files as the primary source for interrogation and self-tuning.
- SkillForge (0f) validates new skills against the relevant instruction files before opening a PR.
- The two Never-Close issues (01) are the forcing function that keeps this entire system aligned with the code.

---

### 6. Deliverables & Maintenance

**When to Create**  
Bootstrap these files after Phase 1 or 2 (once the core runtime and safety pipeline are stable).

**When to Update**  
- After every major milestone (Phase 0–4)  
- After any architecture change  
- When a new agent or domain is added

**How to Update**  
- Follow the checklist in the recurring maintenance issue  
- Add a dated comment with summary of changes  
- Ensure all cross-references to the living specification remain current

**What NOT to Do**  
- Never leave agent or instruction files stale  
- Never add new agents without updating the DevLoop ignition prompt  
- Never bypass the instruction system in SkillForge or DevLoop sessions
