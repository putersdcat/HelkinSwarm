# HelkinSwarm Project Specification – Addendum Series
## 0m. Agentic-Tooling-Evaluation-Automation-and-Self-Tuning-Loop.md

**Version:** 1.0 (Unchained Edition)  
**Status:** Core Architecture Requirement – MVP Blocking  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-13

### 1. Purpose & Vision
The self-tuning evaluation loop is the mechanism that keeps HelkinSwarm’s tool presentation optimal across all models (global frontier default + EU DataZoneStandard toggle).  

It allows the DevLoop agent (VS Code + GitHub Copilot Chat) to interrogate the live runtime, generate candidate “mask files”, run rigorous benchmarks, and auto-promote winning configurations — all without human intervention.

This turns tool presentation from a static lowest-common-denominator into a continuously evolving, model-specific intelligence layer.

### 2. Core Concepts
- **Mask Files** — Per-model JSON (and optional Markdown) that define exactly how tools are presented (style, max tools, progressive reveal, naming, examples, limitations).
- **Eval Store** — Git-tracked JSON + charts containing scores, logs, and plots.
- **Side-Channel** — The bidirectional DevLoop relay (0g) for privileged, non-user-visible communication.
- **Monte-Carlo Benchmarking** — Automated A/B/N testing against synthetic + real enterprise tasks.

### 3. Mask File Format (v1)

```json
{
  "model": "grok-4-1-fast-reasoning",
  "version": "2026-03-13",
  "presentation": "flat_json" | "progressive" | "mcp" | "cli_mimic",
  "max_tools_per_turn": 12,
  "progressive_reveal": true,
  "schema_injection": "on_first_mention",
  "preferred_naming": "snake_case_with_domain_prefix",
  "examples": [ ... ],
  "known_limitations": [ ... ]
}
```

Masks live in `model-profiles/<model-id>/` and are committed to Git.

### 4. Self-Tuning Evaluation Loop (DevLoop → Runtime)

**Trigger conditions**
- New model becomes available (global or EU)
- Toolset changes (new capabilities or SkillForge merge)
- Manual `DEVLOOP: re-eval` command
- Scheduled run
- CI/CD hook on mask or capability change

**Workflow**
1. **Discovery** — DevLoop sends `DEVQUERY: probe_limits model=xxx tools=full-set`. Runtime self-reports.
2. **Hypothesis Generation** — DevLoop creates 3–5 candidate masks (runtime report, public priors, DevLoop hunches, MCP variant).
3. **Monte-Carlo Benchmarking** — Run 100+ synthetic + real tasks across all models. Capture success rate, latency, token efficiency, safety, verification pass rate.
4. **Scoring & Promotion** — Weighted score selects winner. Winning mask is committed and becomes active.
5. **Regression Guard** — If score drops ≥10 % on future runs, auto-rollback + alert.

### 5. Delivery Methods

- **Primary** — DevLoop harness + Teams Test Harness MCP (interactive tuning).
- **CI/CD** — GitHub Actions workflow (scheduled, on-push to tools/ or masks/, repository_dispatch).
- **Future** — Azure-native Agent Service when available.

### 6. Public Baseline Integration
- MCP-Bench (Accenture) — 28 live MCP servers, 250+ tools.
- awesome-ai-eval meta-repo.
- DevLoop automatically adapts public tasks to our internal tool signatures.

### 7. Non-Functional Requirements
- Security: Side-channel messages signed with Azure AD app-only token.
- Data Residency: All eval traffic respects EU toggle.
- Observability: Every mask change creates a GitHub Issue with before/after charts.
- Scalability: Parallel evaluation jobs (up to 10 concurrent model variants).

### 8. Success Metrics
- ≥90 % success rate on internal benchmark suite for every model.
- Mask updates happen autonomously ≥95 % of the time.
- Zero manual mask editing after initial setup.
- Regression alerts <2 per quarter.

### 9. Backlog Linkage
- Built directly on 0b (high-level model presentation), 0g (DevLoop side-channel), 0e (Safety Pipeline), 0a (Modularity).
- Enables the full self-improving organism.
