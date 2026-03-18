# HelkinSwarm Project Specification

## 1. Project Overview & Goals (Refined)

**Project Name:** HelkinSwarm  
**Version:** 1.0 (Greenfield Rebuild – “Unchained”)  
**Author:** Eric Anderson (principal developer)  
**Status:** Fresh start — March 2026  
**Home:** Personal Azure tenant (Tenant ID: `b8ee8812-3a34-43b9-a298-47ebe7ffced8`, primary domain: `ericeanderson.onmicrosoft.com`)

### Vision

HelkinSwarm is **my personal, sovereign AI copilot** that lives natively inside Microsoft Teams and has deep, safe, delegated access to my entire Microsoft 365 + Azure + GitHub Enterprise ecosystem.

It is not a chatbot. It is a **persistent, self-improving orchestration system** built as a true digital extension of me — a forward-deployed Special Circumstances unit in the spirit of Iain M. Banks’ Culture series.

At its core:
- An **eternal overseer** (Durable Functions) that maintains long-horizon context across days or weeks
- A **recursive session spawner** that defeats context collapse
- A **hybrid LLM routing layer** with **global frontier models by default** (Grok, GPT, etc.)
- A **four-eyes safety & verification pipeline** on every action
- A **declarative capability framework** that makes adding new tools trivial and auditable
- Skill-specific long-term memory vaults + just-in-time injection
- Full support for future Virtual Employees (the “Children of HelkinSwarm”)

**This is the “HelkinSwarm Unchained” rebuild.** Global frontier models are the **default** for maximum capability and speed. EU DataZoneStandard residency is supported as an **optional toggle** (via Bicep/pipeline parameter `euResidencyMode`) when compliance demands it — never the starting point.

The end goal: I can `@HelkinSwarm` in Teams with natural language and it **gets real work done** across my inbox, calendar, Teams, SharePoint, GitHub, and Azure — with full auditability, zero standing privileges, and the feeling of a true digital limb.

This is **my IP, built on my own time**. It exists first for my personal automation needs, with the option to open-source or commercialise it later under my own terms.

### Core Principles (non-negotiable)

1. **Personal Sovereignty** — Everything runs in my personal Azure tenant and personal Microsoft 365 tenant.  
2. **Maximum Performance First** — Global frontier models are the default. No artificial residency limits unless explicitly enabled.  
3. **EU Residency as Toggle** — Full EU DataZoneStandard mode is available via a simple pipeline flag (see 03-Tech-Stack-Infrastructure.md).  
4. **Safety by Architecture** — Human confirmation, prompt shields, scoped 5-minute tokens, executor agents, verification pipeline (detailed in 0e).  
5. **Self-Improvement Loop** — DevLoop harness (0g) can interrogate, benchmark, and auto-tune the system (0b).  
6. **Lean & Observable** — Desired-state Bicep, GitHub-native CI/CD, everything versioned.  
7. **Modular by Design** — Core vs Skills Library separation (0a) so the system can grow into multiple libraries, providers, or deployments without refactoring.  
8. **Digital Body Ethos** — Master = brain, Virtual Employees = organs, Skills = reflexes, Hydra-Net = senses (0j, 0k, 0l).

### Success Definition (v1.0 MVP)

By the time this spec is fully implemented:
- I can `@HelkinSwarm` in Teams and it reliably handles complex, multi-tool, long-running workflows across all my systems at full global performance.
- EU residency mode can be toggled on/off via pipeline config without code changes.
- All actions are auditable, reversible where possible, and gated by the four-eyes pipeline (0e).
- The system survives context collapse via overseer + summarization.
- Full E2E testing is possible from VS Code via the Teams Test Harness MCP.
- The entire stack is deployed via `git push main` in my personal tenant.

### Out of Scope for v1.0

- Voice-to-voice (Teams call join + Azure Speech) — Phase 2  
- Meeting side-panel / Live Share visuals — Phase 3  
- Full 3.0 Virtual Employees / swarm spawning — architected (0j) but deferred to post-MVP  
- Public/open-source release — remains a personal tool for now
