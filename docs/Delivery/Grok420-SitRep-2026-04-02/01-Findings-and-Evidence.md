### 01-Findings-and-Evidence.md
**Key Evidence-Backed Findings (April 2026)**

**Strengths (working well)**
- Architecture is coherent and matches the living spec (eternal overseer, session sub-orchestrator, declarative capabilities, safety-by-architecture).
- Tool dispatch + MCP integration layer is mature and actively being extended (Azure MCP, Graph Enterprise MCP, Microsoft Learn MCP all landed in last 48 hours).
- Exact-tool forcing, deterministic JSON replies, and sub-agent isolation are now solid.
- DevLoop / self-improvement loop exists and is being used (many recent issues closed with live validation evidence).

**Critical Maturity Debt (the real story)**
- **Skill operational state is under-modelled** (#484): The Skills Library and discovery paths still conflate “loaded/installed” with “actually working”. Several skills (including the new MCP ones) show as installed but are not yet fully operational in the tenant.
- **Follow-up execution drift** (#485): After discovery or status answers, the bot frequently falls back to prose instead of executing the discovered tool. This is the #1 user-visible honesty gap.
- **User-facing honesty surfaces lag behind code** (#483): Status badges, readiness labels, and discovery-to-action transitions are the weakest part of the product edge right now.
- **Quoted/follow-up continuity** is still brittle in some paths even though the quoted context is present in prompt construction.
- Several “closed” issues were narrower than they appeared on first glance; the broader product-level honesty debt remains the dominant theme.

**Architecture vs Runtime Reality**
The digital-body metaphor is real in code, but the nervous system (Hydra-Net + memory injection) and reflexes (skills) are still ahead of the user-facing honesty layer.

**Biggest Risk Right Now**
Continuing to ship new MCP skills and capabilities before fixing the honesty/execution-proof layer will compound user confusion and trust debt.
