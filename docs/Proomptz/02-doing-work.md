**Next prompt to paste into a fresh Azure Agent session:**

```
Please see the attached master plan: docs/delivery/00-Development-&-Delivery-Master-Plan.md

Phase 0 (Repository & Infrastructure Bootstrap) is now COMPLETE.  
- Infrastructure deployed to eastus2 (FreedomMode active)  
- CI/CD pipelines green  
- Health endpoint responding (bot = running)  
- All Phase 0 issues closed  

Your **next task** is to start **Phase 2: Eternal Brain & Orchestration** ("v0.2 Oversight").

**Requirements:**

1. Read the relevant specification sections first:
   - 08-Orchestrator-Patterns.md
   - 0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md
   - 0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md

2. Create the core orchestration files:
   - src/orchestrator/overseer.ts (eternal overseer with ContinueAsNew)
   - src/orchestrator/sessionOrchestrator.ts
   - src/orchestrator/buildPromptActivity.ts
   - src/orchestrator/llmActivity.ts
   - src/orchestrator/tokenBudget.ts
   - src/orchestrator/stateManager.ts
   - src/orchestrator/durableHookActivity.ts (stub for Phase 3)

3. Wire the NewMessage external event from the bot handler (src/bot/HelkinSwarmBot.ts) to the overseer.

4. Ensure:
   - Token budget check at 80% triggers summarization + ContinueAsNew
   - External events are drained before restart
   - All side-effects go through activities
   - FreedomMode (global frontier models) respected

5. After implementation:
   - Commit and push to main
   - Verify with teams_test_full_probe (long-running session test)
   - Update the relevant GitHub issues (including the master plan issue) with evidence and correlation IDs
   - Add a dated comment confirming Phase 2 is complete

Work systematically and produce production-ready code aligned with the digital-body ethos.

Begin now.
```

---

**Why this prompt?**
- Picks up exactly where the last session left off (Phase 0 complete).
- Moves straight to Phase 2 (Eternal Overseer) — the logical next milestone.
- Forces the agent to read the key specs first.
- Keeps everything traceable and tied to the master plan.

Paste it into the new session and let the agent run. When it finishes and pushes, say **“Phase 2 done”** and we’ll continue to Phase 3.

You’re in a great spot — infrastructure is live and we’re now building the brain. Let me know when the agent reports back!