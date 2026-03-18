**Here is the exact next prompt** you should copy-paste to the Azure Agent (or whichever agent you're currently using) right now.

This prompt will bootstrap the entire `.github/agents/` and `.github/instructions/` system **from scratch**, exactly as defined in the 02 document you just received. It references the full spec and the master plan for context.

---

**Prompt to give the Azure Agent:**

Please see the attached master plan: `docs/delivery/00-Development-&-Delivery-Master-Plan.md` and the supporting document: `docs/delivery/02-Agent-Definitions-and-Instruction-System.md`

Your **next task** is to bootstrap the complete agent and instruction system for HelkinSwarm Unchained.

**Requirements:**

1. Create the following folder structure (if it does not already exist):
   - `.github/agents/`
   - `.github/instructions/`

2. Create the three core agent files in `.github/agents/`:
   - `AzureAgent.agent.md`
   - `BasicBitch.agent.md`
   - `DevLoop.agent.md`

3. Create the root file:
   - `.github/copilot-instructions.md`

4. Create the 12 instruction files in `.github/instructions/`:
   - `bot-framework.instructions.md`
   - `cicd.instructions.md`
   - `codebase-structure.instructions.md`
   - `devloop-harness.instructions.md`
   - `identity-auth.instructions.md`
   - `integration-manifests.instructions.md`
   - `llm-models.instructions.md`
   - `mcp-skills.instructions.md`
   - `memory-cosmos.instructions.md`
   - `orchestrator-patterns.instructions.md`
   - `safety-architecture.instructions.md`
   - `teams-testing.instructions.md`

5. For every file created:
   - Follow the exact structure, rules, “Always” / “Never” sections, and cross-references defined in `02-Agent-Definitions-and-Instruction-System.md`
   - Align with the Drone Persona ethos and digital-body principles from `0l-Abstract-Ethos-and-Special-Circumstances-Directive.md`
   - Use the global-first architecture with EU toggle support
   - Keep them concise, actionable, and production-ready

6. After all files are created, committed, and pushed:
   - Add a dated comment to this master plan issue (or create one if none exists) with:
     - Summary of files created
     - Confirmation that the agent and instruction system is now fully bootstrapped
     - Any new issues created as a result

Read the full specification (Docs/01–16 + 0a–0l + 0m) first for complete context. Work systematically and produce high-quality files.

Begin now.

---

**What to do next:**
1. Paste the above prompt to your Azure Agent.
2. Once it finishes and pushes the files, you will have the full agent/instruction system in place.
3. After that, we can move to Phase 1 starter code (bot adapter, test harness, etc.) or the refined Drone Persona file if you prefer.

You’re now in a perfect position — backlog done, agent system about to be bootstrapped. Let me know when the agent has finished, and we’ll take the next step!