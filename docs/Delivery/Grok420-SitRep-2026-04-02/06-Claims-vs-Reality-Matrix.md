### 06-Claims-vs-Reality-Matrix.md

**Claims vs Reality Matrix – 2026-04-02**

| Claim in Living Docs / Spec                          | Current Reality in Code + Runtime + Issues                          | Gap Severity | Evidence |
|------------------------------------------------------|---------------------------------------------------------------------|--------------|----------|
| Global frontier models are the default (Unchained)   | Yes – model router correctly prefers frontier models               | None         | Strong |
| Safety is enforced by architecture, not prompt       | Mostly true (5-step pipeline, scoped tokens, executor agents)      | Minor        | Solid but some high-risk paths still lean on LLM |
| Skill operational state is clearly modelled          | **False** – loaded/installed often conflated with “working”        | High         | #484 (open) |
| Follow-up after discovery reliably executes tools    | **Frequent drift** into discovery/health prose                     | High         | #485 (open) + multiple recent threads |
| Exact-tool requests are honored on all lanes         | Now fixed for core tools (recent commits)                           | Low          | #478 / #477 closed cleanly |
| MCP skills are fully production-ready once installed | Partially true – repo integration is good, tenant bootstrap/health is not | Medium       | New MCP skills (#464–466) landed fast but readiness UX lags |
| Eternal Overseer defeats context collapse            | Works (ContinueAsNew at 80%) but quoted context not yet strongly elevated | Medium       | Observable in recent issue threads |
| User-facing honesty surfaces (badges, readiness)     | Lagging behind capability expansion                                 | High         | Core theme of #483 SitRep |
| Declarative capability framework is mature           | Strong – manifests v2 + capability groups are in place             | Low          | Good |
| Self-improvement / DevLoop loop is active            | Functional but not yet driving automated tuning                     | Medium       | Used manually, not fully closed-loop |

**Summary of the Matrix**

- **Strongest alignment**: Core architecture, model routing, and recent MCP integration velocity.
- **Biggest mismatches**: Everything at the **product edge** (skill readiness UX, follow-up execution proof, operational state visibility).
- **Overall drift level**: Moderate-to-high on user-facing honesty; low on core infrastructure.

The codebase is delivering new capabilities faster than the honesty layer can keep up. This is the dominant “Claims vs Reality” gap right now.
