# gstack source info

- **Repository:** `https://github.com/garrytan/gstack`
- **Owner:** `garrytan`
- **License:** `MIT`
- **Analysis date:** `2026-03-30`
- **Analyzed commit:** `66c09644a70a849447291cd8e6286b64203933c1`
- **Commit summary:** `feat: composable skills — INVOKE_SKILL resolver + factoring infrastructure (v0.13.7.0) (#644)`
- **Observed package version:** `0.13.9.0`
- **Latest visible root commit on repo landing page during analysis:** `66c0964` (about 1 hour old at time of review)
- **Primary languages (GitHub):** TypeScript, Go Template, Shell, JavaScript

## Primary source artifacts reviewed

- Root repository page and linked docs pages via web fetch
- `README.md`
- `ARCHITECTURE.md`
- `docs/skills.md`
- `AGENTS.md`
- `package.json`
- `setup`
- Root tree listing at analyzed commit

## High-confidence repo facts

1. gstack is an **opinionated skill pack + browser runtime** built primarily around the `SKILL.md` ecosystem.
2. The browser capability is implemented as a **compiled CLI + localhost daemon + persistent Chromium** model, optimized for sub-second iterative agent actions.
3. The project supports multiple hosts (`claude`, `codex`, `kiro`, `factory`, `auto`) through generated skill docs and host-specific setup flows.
4. The repo is explicitly designed for **single-user local agent workflows**, not multi-tenant cloud bot execution.
5. Testing is tiered: cheap static validation first, then expensive E2E / LLM-eval tiers.

## Analyst notes

- The repo is highly active, rapidly iterated, and strongly shaped by one operator’s workflow philosophy.
- The biggest reusable value for HelkinSwarm is **process architecture and local browser ergonomics**, not a drop-in runtime integration.
- The biggest mismatch is **deployment model**: gstack assumes local interactive agent sessions; HelkinSwarm is a Teams + Azure Durable cloud bot.
