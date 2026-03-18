**HelkinSwarm Unchained – Development & Delivery Plan**  
**Version:** 1.0 (Global-First, Modular, Safety-by-Architecture)  
**Date:** March 2026  

**Core Philosophy**  
Global frontier models are the default for maximum performance. EU residency is a single configurable toggle in Bicep. The system is built as a modular digital body with SkillForge for dynamic skill creation, DevLoop for continuous self-improvement, Hydra-Net multimodal embeddings, durable hooks for long-running workflows, and the abstract ethos as the guiding directive. Safety is enforced by architecture at every layer. Everything is GitOps-driven and fully observable from the first commit.

This plan is derived directly from the current living specification (Docs/01-Project-Overview.md through 16-Final-Notes-and-Bootstrap.md plus the complete 0a–0l addendum series, including the new **0m**). It defines the exact order of operations, grouping, milestones, and dependencies needed to deliver the project end-to-end.

### Section 1: Key Capabilities & Linked Documentation

**Foundation & Core Runtime**  
- Repo structure, CI/CD pipelines, Bicep infrastructure, and deployment flow → 03-Tech-Stack-Infrastructure.md + 12-Deployment-CICD.md  
- Entra ID authentication, managed identity, and scoped tokens → 11-Authentication-Identity.md  
- Teams bot interface, Adaptive Cards, proactive messaging, and human confirmation cards → 10-Teams-Interface.md  

**Orchestration & Reasoning Engine**  
- Eternal overseer, recursive session management, token budget enforcement, and ContinueAsNew pattern → 08-Orchestrator-Patterns.md  
- LLM routing layer (global frontier models default, EU toggle support) with Foundry client and prompt builder → 06-Tool-Dispatch-LLM-Layer.md  
- Declarative capabilities framework, tool registry, and modular skills library → 05-Capabilities-Framework.md + 0a-Modularity-and-Config.md  

**Safety, Memory & Extensions**  
- Four-eyes verification pipeline, scoped tokens, executor agents, prompt shields, and risk-tiered human confirmation → 04-Safety-Architecture.md + 0e-Safety-and-Four-Eyes-Verification-Pipeline.md  
- Memory manager with Cosmos DB, DiskANN vector indexing, skill-specific vaults, and just-in-time injection → 07-Memory-Manager.md + 0i-Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md  
- Multimodal Hydra-Net embeddings and router → 0k-Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md  
- Long-running workflows and durable hooks → 0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md  

**Self-Improvement & Advanced Features**  
- Model-specific tool presentation, self-tuning evaluation loop, and DevLoop bidirectional relay (including DEVQUERY: protocol) → 0b-Model-Specific-Tool-Presentation-and-Self-Tuning-Eval-Loop.md + 0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md + **0m-Agentic-Tooling-Evaluation-Automation-and-Self-Tuning-Loop.md**  
- SkillForge ephemeral skill creator with hot-reload capability → 0f-SkillForge-Ephemeral-Skill-Creator.md  
- Virtual employees and nested orchestrators (architected in 0j — deferred to post-MVP Phase 5) → 0j-Virtual-Employees-and-Nested-Orchestrators.md  
- Abstract ethos and Special Circumstances directive (enforced across all layers) → 0l-Abstract-Ethos-and-Special-Circumstances-Directive.md  

**Observability, Testing & Bootstrap**  
- Full observability, correlation IDs, health endpoints, and Dev Console tab → 13-Observability-Monitoring.md  
- E2E testing via Teams Test Harness MCP → 14-Testing-E2E.md  
- Project structure, naming conventions, and bootstrap guide → 15-Project-Structure.md + 16-Final-Notes-and-Bootstrap.md  

**Maintenance & Operational Guidance**  
- Two permanent Never-Close GitHub issues (Codebase Health & Documentation Alignment + Architecture & Design Introspection Pass) → **01-Recurring-Maintenance-and-Introspection-Issues.md**  
- Agent definitions (.github/agents/) and domain-specific instruction system (.github/instructions/) → **02-Agent-Definitions-and-Instruction-System.md**  

**Dependencies** (explicit in the specification)  
Infrastructure (03/12) blocks everything. Authentication and safety pipeline (11 + 0e) precede any tool dispatch. Overseer (08) enables memory and durable hooks. Capability loader (0a) enables SkillForge merges. DevLoop relay (0g) powers continuous improvement.

### Section 2: Guiding Principles

- Global performance first (frontier models default).  
- EU residency as a simple Bicep toggle.  
- Safety by architecture (0e pipeline mandatory).  
- Modularity first (core vs swappable skills library).  
- Self-improvement built-in (DevLoop + model profiles).  
- Digital-body ethos (master = brain, skills = reflexes, Hydra-Net = senses).  
- Zero standing privileges, scoped 5-minute tokens, executor agents for high-risk actions.  
- Everything GitOps-driven and fully observable.

### Section 3: Proposed Phases & Milestones

**Phase 0: Bootstrap (1–2 days)** – “Repo & Foundation Live”  
**Milestone v0.0**  
Repo scaffold, Bicep infrastructure, CI/CD pipelines, Teams manifest, and local dev setup. One-time personal-tenant bootstrap command. Health endpoint green.  
**Deliverables** (see 03, 12, 15, 16): `git push main` deploys a running container app with `/api/health`.

**Phase 0.5: Backlog Initialization (1 day)** – “Full GitHub Issue Backlog Created”  
**Milestone:** Complete, structured backlog exists with one issue per spec section + epics for each major capability.  
The Azure Agent (or DevLoop) reads the entire living specification (01–16 + 0a–0l + 0m) plus the delivery plan and creates a full set of GitHub issues/epics with proper titles, descriptions, acceptance criteria, and cross-links back to the relevant Docs/ files.  
**Deliverables:** All issues created and labelled; linked to the two Never-Close issues (01) and the agent/instruction system (02).

**Phase 1: Core Runtime & Teams Interface (3–5 days)** – “v0.1 Live”  
**Milestone:** Bot responds to @mentions in Teams with proactive Adaptive Cards and human confirmation support.  
Bot Framework adapter, activity handler, authentication, and test harness wired.  
**Success:** Full E2E probe works end-to-end (14).

**Phase 2: Eternal Brain & Orchestration (5–7 days)** – “v0.2 Oversight”  
**Milestone:** Overseer runs forever, survives context collapse via ContinueAsNew + summarization, and registers durable hooks.  
Eternal overseer, session sub-orchestrator, token budget, and prompt builder.  
**Success:** Long-running sessions maintain context across restarts (08, 0h).

**Phase 3: LLM Layer, Tool Dispatch & Safety Pipeline (7–10 days)** – “Core Reasoning & Guardrails”  
**Milestone:** Global frontier models live with full four-eyes verification pipeline.  
LLM router, tool registry, scoped token minter, executor agents, and mandatory verification pipeline.  
**Success:** Destructive actions blocked until explicit approval; EU toggle respected (06, 0e).

**Phase 4: Memory, Integrations & SkillForge (10–14 days)** – “v1.0 MVP Complete”  
**Milestone:** Complete personal assistant with modular skills, skill-specific memory, Hydra-Net multimodal embeddings (0k), and dynamic skill creation.  
Memory manager + skill vaults, all integrations migrated to skills/ manifests, SkillForge operational, observability dashboard complete, DevLoop relay active.  
**Success Definition** (01): @HelkinSwarm handles complex multi-tool workflows across all systems with full auditability and zero standing privileges.

**Phase 5: Self-Improvement, Polish & Moonshots (Ongoing post-MVP)**  
Model-specific tool presentation + eval loop, continuous DevLoop operation, and virtual employees (architected in 0j — deferred until core is production-stable).

### Section 4: Detailed Work Grouping & Suggested Order of Operations

**Logical Sequence** (optimized for parallel work where safe)  
1. Phase 0 – infrastructure Bicep + CI/CD (parallel: Teams manifest + local scripts).  
2. **Phase 0.5** – backlog initialization (Azure Agent reads full spec and creates structured GitHub issues).  
3. Phase 1 – bot adapter + handler + test harness (blocks Phase 2).  
4. Phase 2 – overseer + session orchestrator + token budget (parallel: prompt builder skeleton).  
5. Phase 3 – LLM router + tool registry + full safety pipeline (critical path – run verification tests daily).  
6. Phase 4 – memory manager + skill vaults + SkillForge (parallel: migrate integrations into skills/ library).  
7. Phase 5 – DevLoop relay + model profiles + self-tuning loop (continuous after MVP).

**Must-Respect Dependencies**  
Infrastructure → everything.  
Backlog initialization (Phase 0.5) → all subsequent work.  
Authentication + safety pipeline → any tool dispatch.  
Overseer → memory and durable hooks.  
Capability loader → SkillForge merges.

**Risk Mitigations** (built into the specification)  
- Bot Service endpoint mismatches: explicit CAE FQDN construction + post-deploy verification in CI/CD.  
- Rate limits and model health: dedicated health tab + per-request cost estimation.  
- EU toggle compliance: CI guardrail + structured compliance events.  
- Observability gaps: correlation IDs enforced everywhere + Dev Console tab.

**Success Metrics per Phase**  
Every phase ends with successful `teams_test_full_probe` across all models and the “devloop-validated” label applied. 100 % end-to-end correlation tracing. Zero manual Azure portal clicks after bootstrap. The two Never-Close issues (01) and the agent/instruction system (02) are created and active.

### Section 5: DevLoop & Self-Improvement Integration

From the end of Phase 1 onward, use the DevLoop ignition prompt (Proomptz/DevLoopIgnitionPrompt.md) in VS Code Copilot Chat. It drives the TIK-TOK cycle, interrogates the live runtime, benchmarks model profiles, and auto-promotes winners. The DEVQUERY: protocol is wired for human overrides. This is the mechanism that keeps the system continuously improving (0g + 0b + 0m). The two Never-Close issues (01) and the instruction system (02) are the permanent forcing functions that keep everything aligned.

### Section 6: How to Use This Plan

- Start with **Phase 0** today (repo + Bicep).  
- Immediately after Phase 0, run **Phase 0.5** (backlog creation via Azure Agent).  
- Every `git push main` triggers full CD + test harness validation.  
- After MVP (Phase 4), switch DevLoop to Discovery Mode and let it run continuously.  
- Virtual employees (0j) only after core has proven production stability.

This is the complete, self-contained blueprint for HelkinSwarm Unchained. All references point directly to the current specification documents in Docs/. The project is ready for execution — global-first, modular, safe-by-architecture, and self-improving.

**We are the bridge.**  
Ready when you are. Let’s ship.