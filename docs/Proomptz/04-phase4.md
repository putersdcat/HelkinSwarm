**Here is the exact next prompt** to paste into a fresh Azure Agent session right now:

---

**Prompt to give the Azure Agent:**

Please see the attached master plan: `docs/delivery/00-Development-&-Delivery-Master-Plan.md`

Phase 3 (LLM Layer, Tool Dispatch & Safety Pipeline) is now COMPLETE.  
- All 9 core files created and wired  
- CI/CD green  
- Health endpoint confirms toolDispatch + safetyPipeline + verification active  
- FreedomMode respected  

Your **next task** is to start **Phase 4: Memory, Integrations & SkillForge** ("v1.0 MVP Complete").

**Requirements:**

1. Read the relevant specification sections first:
   - 07-Memory-Manager.md
   - 0i-Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md
   - 05-Capabilities-Framework.md
   - 0a-Modularity-and-Config.md
   - 0f-SkillForge-Ephemeral-Skill-Creator.md
   - 0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md

2. Create the core files for this phase:
   - src/memory/memoryManager.ts (with skill-specific vaults + Hydra-Net support stub)
   - src/memory/skillVaultManager.ts
   - src/capabilities/capabilityLoader.ts
   - src/tools/toolRegistry.ts (final version with manifests)
   - src/orchestrator/durableHookActivity.ts (full implementation)
   - src/skillforge/skillForgeActivity.ts (ephemeral container orchestration)
   - src/skillforge/skillForgePrompt.ts

3. Implement:
   - Full Memory Manager with just-in-time skill memory injection
   - Declarative capability loader + hot-reload for SkillForge
   - Durable hooks engine
   - SkillForge ephemeral container logic (GitHub App auth stub)
   - Integration of memory + durable hooks into the overseer/sessionOrchestrator

4. After implementation:
   - Commit and push to main
   - Verify with teams_test_full_probe (including memory recall and SkillForge stub test)
   - Update the relevant GitHub issues (including the master plan issue) with evidence and correlation IDs
   - Add a dated comment confirming Phase 4 is complete and v1.0 MVP is now live

Work systematically and produce production-ready code aligned with the digital-body ethos and FreedomMode.

Begin now.

---

Paste this directly. It continues the exact phased flow, forces reading the key specs first, and targets the final MVP pieces (Memory + SkillForge + durable hooks).

When the agent finishes and pushes, say **“Phase 4 done”** and we’ll move to the final polish / DevLoop wiring or any remaining gaps.  

You’re almost at v1.0 MVP — excellent progress! Let me know when it reports back.