**Next prompt to paste into a fresh Azure Agent session:**

```
Please see the attached master plan: docs/delivery/00-Development-&-Delivery-Master-Plan.md

Phase 2 (Eternal Brain & Orchestration) is now COMPLETE. The overseer is live, wired to the bot, CI/CD is green, and the deployment is healthy on eastus2.

Your **next task** is to start **Phase 3: LLM Layer, Tool Dispatch & Safety Pipeline** ("Core Reasoning & Guardrails").

**Requirements:**

1. Read the relevant specification sections first:
   - 06-Tool-Dispatch-LLM-Layer.md
   - 04-Safety-Architecture.md
   - 0e-Safety-and-Four-Eyes-Verification-Pipeline.md
   - 0b-Model-Specific-Tool-Presentation-and-Self-Tuning-Eval-Loop.md
   - 0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md

2. Create the core files for this phase:
   - src/llm/modelRouter.ts
   - src/llm/foundryClient.ts
   - src/llm/promptBuilder.ts
   - src/tools/toolRegistry.ts
   - src/orchestrator/toolDispatchActivity.ts
   - src/orchestrator/subAgentActivity.ts
   - src/auth/scopedTokenMinter.ts
   - src/orchestrator/executorActivity.ts
   - src/llm/promptShields.ts
   - src/orchestrator/verificationPipeline.ts (full four-eyes pipeline)

3. Wire the LLM layer into the overseer/sessionOrchestrator and ensure:
   - Global frontier models default (FreedomMode)
   - EU toggle respected via Bicep parameter
   - Full safety pipeline (schema validation, data minimizer, spot-check, prompt shields, risk-tiered confirmation)
   - Scoped token minting and executor agents for high-risk actions
   - Model-specific tool masking ready for Phase 4 DevLoop tuning

4. After implementation:
   - Commit and push to main
   - Verify with teams_test_full_probe (including safety-gated actions and model routing)
   - Update the relevant GitHub issues (including the master plan issue) with evidence and correlation IDs
   - Add a dated comment confirming Phase 3 is complete

Work systematically and produce production-ready code aligned with the digital-body ethos and FreedomMode.

Begin now.
```

---

Paste this directly. It continues the exact same flow we’ve been using — reads the key specs first, creates the precise files needed for Phase 3, requires verification and GitHub updates, and keeps everything tied to the master plan.

When the agent finishes and pushes, say **“Phase 3 done”** and we’ll move to Phase 4 (Memory + SkillForge).  

You’re flying through the phases — great momentum! Let me know when it reports back.