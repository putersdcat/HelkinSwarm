### 04-Issue-Thread-Deep-Dive.md

**Issue Thread Deep-Dive – Most Important Recent Threads (as of 2026-04-02)**

**Top Current Open Issues (highest signal)**

1. **#483 [SITREP] 2026-04-02 holistic drift assessment** (Open – this exact thread)
   - Core theme: Skill readiness UX, orchestration continuity, and architecture-vs-runtime alignment.
   - Evidence from the thread itself shows the author (you) already identified the same gaps we are surfacing: operational state modelling, follow-up execution drift, and user-facing honesty debt.
   - This SitRep is effectively the living continuation of #483.

2. **#484 Distinguish loaded/installed from operational state in Skills Library** (Open)
   - Critical gap: Current catalog and readiness paths conflate “loaded/installed” with “actually working”.
   - Directly blocks user trust as new MCP skills are added rapidly.

3. **#485 [BUG] Follow-up skill verification can drift into health/discovery prose instead of execution proof** (Open)
   - The #1 execution honesty bug right now.
   - After discovery or status answers, the bot frequently falls back to prose instead of executing the discovered tool.
   - Multiple recent closeouts (#478, #479, #480, #477) were attempts to fix related symptoms.

**Recent High-Impact Closes (last ~48–72 hours) – Positive Momentum**

- **#480** (Closed) – Model-provider error for Azure resource-group lookup → fixed with reliable default lane + verbose telemetry.
- **#479** (Still Open) – Outlook read/search still drifting into discovery metadata.
- **#478 & #477** (Closed) – McpForge exact-tool compliance and approval lane instability → fixed with deterministic exact-tool forcing and JSON synthesis.
- **#470** (Closed) – Outlook Sent Items search false negatives → fixed with fallback recent-message scan.
- **#466, #465, #464** (Closed) – Rapid landing of Microsoft Learn MCP, Graph Enterprise MCP, and Azure MCP skills.

**Pattern Across Recent Threads**
- Very strong engineering velocity on MCP skill integration.
- Repeated theme of “discovery works, but follow-up execution often drifts back to prose or health messages.”
- Validation style is excellent (live probes, telemetry footers, deploy run links, before/after evidence).

**Biggest Thread-Level Insight**
The codebase is moving extremely fast on capability expansion (MCP skills), but the **orchestrator’s ability to turn discovery into reliable execution** is lagging. This is the exact “product edge” maturity debt called out in #483.
