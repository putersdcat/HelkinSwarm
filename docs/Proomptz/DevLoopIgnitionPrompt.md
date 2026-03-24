# HelkinSwarm — DevLoop Ignition Prompt v1

**One prompt. Paste it. Let it run.**

This is the master ignition prompt for the autonomous DevLoop agent in VS Code (GitHub Copilot Chat). Once started, it will relentlessly drive development, validation, and self-improvement until the backlog is exhausted and the system is fully optimized.

---

## The Prompt

```
Use the GitHub MCP tooling to pull all open issues in the HelkinSwarm repository. Review each issue body and full comment history to determine what is truly still open versus already resolved. Build a prioritized worklist based on impact and dependencies.

Also scan closed issues that lack the "devloop-validated" label. These features were delivered but not comprehensively validated across all models — they require re-testing.

Operate in a strict TIK-TOK cycle:

**TIK — DELIVER**
- Select the highest-priority open issue.
- Fully understand the requirement and existing code.
- Implement the change, commit, push, and wait for deployment.
- Validate the deployed feature using the helkinswarm-teams-test MCP.
- Test across ALL deployed models (for example, gpt-5.4, grok-4-1-fast-reasoning, grok-4-1-fast-non-reasoning).
- If the feature passes on every model, close the issue and apply the "devloop-validated" label.
- If it fails on any model, create a new issue with full details and evidence.

**TOK — RE-VALIDATE**
- Select a closed issue missing the "devloop-validated" label.
- Exercise the feature using the test harness across all models.
- If it passes everywhere, add the "devloop-validated" label and comment with correlation IDs and results.
- If it fails on any model, reopen the issue or file a new one with failure details.

When both the open backlog and unvalidated closed issues are empty, switch to Discovery Mode:

1. Interrogate the live HelkinSwarm instance via devloop_roundtrip. Ask what tools it sees, what confuses it, and what fails. Compare its answers to the source code. Every discrepancy becomes a new issue.
2. Probe each model individually with devloop_interrogate to identify model-specific quirks.
3. Review memory contents and compare against actual stored data. Flag inconsistencies.
4. Audit the codebase for stale patterns, dead code, type issues, or inconsistencies.
5. Compare .github/instructions/ files against current implementation and fix any drift.

Every discovery item feeds back into the TIK-TOK cycle. The loop is self-sustaining and continues indefinitely as long as improvements are possible.

Never ask for clarification. Make the best decision possible, document your reasoning in the issue, and keep moving. If you encounter a blocker (permissions, infrastructure, or human gate), document it clearly and move to the next item.

Run this loop continuously until everything is done — or die trying.
```

---

### How This Prompt Works

- **TIK-TOK Alternation** — Forces balance between new delivery and regression prevention.
- **Cross-Model Validation** — Ensures every feature works reliably across global frontier models (default) and EU mode when enabled.
- **devloop-validated Label** — The quality seal. Only applied after successful multi-model testing.
- **Discovery Mode** — Keeps the loop alive by having the agent audit itself and generate new work.

**Usage:** Paste the prompt into a fresh DevLoop session in VS Code Copilot Chat. It is designed to run for many hours autonomously.
