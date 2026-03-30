# gstack — HelkinSwarm research summary

## Executive take

`gstack` is a **highly opinionated AI engineering workflow system** built around:

- role-based `SKILL.md` workflows
- a persistent Playwright-backed browser daemon
- strong review / QA / shipping process structure
- host-specific skill generation for Claude Code, Codex, Kiro, and Factory Droid

It is **not** a direct runtime fit for HelkinSwarm’s deployed Teams bot architecture, but it is **very relevant as a design pattern library** for:

- DevLoop workflows
- browser/tool ergonomics
- structured planning/review/QA chains
- skill-template generation and drift prevention
- eval / observability ideas for agent skills

## Bottom line recommendation

**Recommendation: adopt patterns selectively, do not integrate or fork wholesale.**

### Worth harvesting

1. **Workflow specialization**
   - gstack’s role-oriented skills (`/office-hours`, `/plan-eng-review`, `/review`, `/qa`, `/ship`, `/document-release`) map well to the kind of explicit operator-facing modes HelkinSwarm already wants.
2. **Doc-generation discipline**
   - their `SKILL.md.tmpl -> generated SKILL.md` pipeline is a strong anti-drift pattern.
3. **Browser ergonomics**
   - the persistent-browser architecture is excellent for local-agent work and useful inspiration for future HelkinSwarm local tooling or DevLoop-side helpers.
4. **Evaluation tiers**
   - cheap static checks + expensive targeted E2E / LLM evals is a very sane quality model.
5. **Explicit safety helpers**
   - `/careful`, `/freeze`, `/guard` are concrete examples of scoped safety affordances that complement, not replace, architecture.

### Do **not** adopt directly

1. **Runtime/browser daemon model inside the HelkinSwarm cloud bot**
   - gstack assumes a local single-user daemon on localhost with persistent Chromium state.
   - HelkinSwarm runs in Azure Functions / Container Apps and communicates through Teams; that is a different trust boundary and lifecycle.
2. **Full slash-command workflow import**
   - HelkinSwarm already has its own ethos, orchestration rules, safety architecture, and skill boundary model.
   - importing gstack whole would create philosophical and technical collision, not leverage.
3. **Local host assumptions**
   - gstack heavily assumes filesystem state under `~/.gstack`, `~/.claude/skills`, `~/.codex/skills`, and localhost HTTP.
   - that does not map cleanly to HelkinSwarm’s stamped multi-instance cloud topology.

## What gstack actually is

At its core, gstack combines two things:

1. **A persistent browser toolchain** for AI agents
2. **A structured software-delivery process** encoded as reusable skills

The README frames it as a “virtual engineering team” made of specialist roles:

- founder / CEO review
- engineering review
- design consultation and design review
- QA
- security review
- release / ship
- documentation update
- retrospective

This is process-heavy on purpose. The repo is trying to make agentic software delivery repeatable, not merely possible.

## Key strengths

### 1. Clear process design

gstack is unusually explicit about the order of work:

**Think → Plan → Build → Review → Test → Ship → Reflect**

That is strategically relevant to HelkinSwarm because it aligns with the project’s bias toward orchestrated, stateful, multi-step work rather than chat-only improvisation.

### 2. Very strong browser story

The most technically distinctive part is the persistent browser stack:

- compiled CLI
- localhost daemon
- persistent Chromium session
- ref-based interaction model
- cookie/session carry-over
- explicit handoff / resume patterns

That local-automation ergonomics work is real and impressive.

### 3. Documentation anti-drift discipline

gstack treats generated skill docs as a first-class engineering problem. That is useful because agent tool docs drift quickly and silently.

### 4. Testing maturity

The repo has a layered evaluation approach instead of one giant expensive test bucket. That is exactly the kind of quality discipline HelkinSwarm benefits from.

## Key limitations

### 1. Single-user local architecture

The architecture is intentionally **not multi-user** and explicitly avoids multi-tenant concerns. That makes sense for its target use case, but sharply limits direct reuse in HelkinSwarm’s deployed bot runtime.

### 2. Claude-first worldview

Even though gstack now supports Codex and other hosts, the repo’s philosophy and ergonomics are still visibly Claude-native. HelkinSwarm needs model/provider neutrality at the orchestration layer.

### 3. Local-state dependence

A lot of power comes from:

- local files in the operator’s home directory
- long-lived local daemon state
- browser cookies under the user’s own OS account

That does not translate directly to a sovereign cloud copilot running for a specific Teams user inside Azure.

## Best HelkinSwarm uses of this research

- Design a **DevLoop-local browser helper** informed by gstack’s daemon/ref model.
- Borrow **skill-template generation** ideas for HelkinSwarm’s future skill authoring/documentation system.
- Borrow **eval tiering** and observability patterns for agent skill validation.
- Borrow **operator-facing workflow mode names and sequencing**, not the exact commands.
- Study gstack’s **safety affordances** as examples of scoped guardrail UX.

## Recommended disposition

- **Adopt patterns:** yes
- **Fork whole repo:** no
- **Embed directly in stamp runtime:** no
- **Use as inspiration for DevLoop / local tooling:** yes
- **Watch for future ideas:** yes

## Files in this research bundle

- `source-info.md` — source tracking and analyzed commit/version
- `architecture.md` — technical architecture and component map
- `analysis-helkin.md` — HelkinSwarm-specific applicability and risks
