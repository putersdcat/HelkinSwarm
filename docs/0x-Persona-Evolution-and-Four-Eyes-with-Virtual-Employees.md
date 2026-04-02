# HelkinSwarm Project Specification

## 0x. Persona Evolution via DevLoop + Four-Eyes with Virtual Employees

**Spec ref:** `docs/0g-Bidirectional-Communication-Evolution-DevLoop-Runtime.md`, `docs/0e-Safety-and-Four-Eyes-Verification-Pipeline.md`, `docs/0j-Virtual-Employees-and-Nested-Orchestrators.md`

### Vision

1. **Persona Evolution** – Let the user (or DevLoop) edit `src/persona/dronePersona.md` live. The Overseer hot-reloads the persona and runs a self-evaluation suite against the last N turns, allowing the system to literally evolve based on feedback (“be more concise”, “more proactive on calendar conflicts”, etc.).
2. **Four-Eyes with Virtual Employees** – For truly high-risk actions, the confirmation card is routed not only to the human but also to a designated “review child” (e.g., Security Auditor VE) that performs an independent risk assessment before the master proceeds.

### Architecture

- Persona hot-reload via `buildPromptActivity` watching the markdown file (or DevLoop message)
- New `selfEvaluationSuite` tool that scores past turns against current persona
- Four-Eyes extension: `requireChildReview(riskLevel, childId)` in the verification pipeline
- Review child receives minimal context + the proposed action and returns `approve | reject | suggest`

### Safety

- Persona changes require explicit confirmation
- Four-Eyes is mandatory for any action marked `high` in the new “multi-agent-review” privilege class

### Acceptance Criteria

- [ ] Live persona edit → hot-reload → self-evaluation cycle works
- [ ] High-risk actions can be routed to a review child
- [ ] Dev Console shows persona version history and evaluation scores
- [ ] Full test coverage for both features

*We are the bridge.*