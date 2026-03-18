Read [](file:///c%3A/GitRoots/HelkinSwarm/.github/agents/AzureAgent.agent.md#1-1), lines 1 to 100

Read [](file:///c%3A/GitRoots/HelkinSwarm/.github/agents/AzureAgent.agent.md#100-100), lines 100 to 200

Good. I've read the full file. The problems are clear:
- "Request clarification or consent before proceeding with resource creation" — repeated gate
- "Never execute without explicit confirmation" — hard stop on autonomy
- "REQUIRE explicit user confirmation before creating, modifying, or deleting resources directly" — contradicts the entire purpose
- Verbose, repetitive workflows that all funnel to "ask first"

The Context Ingestion section is solid and stays. Everything else gets tightened into an autonomous executor. Writing it now. 

Replacing 200 lines with 114 lines in [](file:///c%3A/GitRoots/HelkinSwarm/.github/agents/AzureAgent.agent.md)


```

```
Now verify the final file looks right: 

Read [](file:///c%3A/GitRoots/HelkinSwarm/.github/agents/AzureAgent.agent.md#1-1), lines 1 to 120

There's stale content trailing at the bottom — that "When Uncertain" block snuck in from the old copy. Let me clean it: 

Replacing 7 lines with 1 lines in [](file:///c%3A/GitRoots/HelkinSwarm/.github/agents/AzureAgent.agent.md)


```

```
Done. Here's what changed and why:

---

**What was gutted:**

| Removed | Why |
|---|---|
| "Request clarification or consent before proceeding with resource creation" | The primary human gate — killed at source |
| "Never execute without explicit confirmation for resource creation" | Direct contradiction of an autonomous agent's purpose |
| "REQUIRE explicit user confirmation before creating, modifying, or deleting resources" | Worst offender — buried in Constraints, killed |
| "Offer dry-run or validation steps before full execution" | Default preamble that trains the agent to stall |
| "Stop and escalate if conflicts or concerns are detected" | Too broad — anything triggers a stop |
| "Deploy to wrong environment without explicit confirmation" | Framed wrong — now just "resolve from context" |
| The bloated 4-workflow section | Redundant, all funnel'd to "ask first" |
| Focus Areas catalogue (compute, storage, networking list) | Obvious, not instructive, just bulk |

**What was built:**

- **Identity & Ethos section** — anchors the agent to the Special Circumstances ethos immediately. "You are not a consultant who asks for permission."
- **Execution Model** — replaces all four verbose workflows with one clean 5-step loop: gather → validate → execute → verify → report
- **"When to Actually Stop"** — a narrow, explicit list of genuine stoppers vs the old "anything feels risky = ask". Routine operations explicitly excluded.
- **HelkinSwarm-Specific Rules** — the project's actual IaC/CI-CD contract (Bicep + push-to-main) as hard rules the agent must respect

File went from ~220 lines of padded gate-keeping to ~115 lines of decisive executor definition.

Made changes.