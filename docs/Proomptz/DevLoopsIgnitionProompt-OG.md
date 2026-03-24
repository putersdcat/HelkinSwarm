# HelkinSwarm — The Loop 👾🔄

**One prompt. Paste it. Walk away.**

This is the ignition key for an autonomous, self-sustaining development and
improvement loop. Give it to the DevLoop agent persona in VS Code Copilot Chat
and it will work continuously — burning through the backlog, interrogating the
remote agent, discovering new work, filing it, fixing it, and looping endlessly
until there is literally nothing left to improve.

---

## The Prompt

```
Use the GitHub MCP tooling to pull all the open issues for putersdcat/HelkinSwarm.
After reviewing the body of each, also look at issues with long comment chains —
read those chains to determine what's actually still open vs what's already done.
Build a prioritised worklist based on impact to the overall project and
dependencies between items.

Also pull closed issues that do NOT have the label "devloop-validated". These are
delivered features that were only minimally validated — they need re-testing
across all the deployed LLMs to confirm they actually work everywhere.

Now run in a Tik-Tok pattern, alternating between two beats:

  TIK — DELIVER: Pick the top open issue. Read code, understand things
        completely, write code, push, wait for deploy. Then validate the
        deployed change using the helkinswarm-teams-test MCP server —
        send chat messages that exercise the feature via devloop_roundtrip.
        But don't just test with the default model. Talk to ALL the models
        at the party: gpt-5, o4-mini, o3, gpt-5-mini, grok-4-1-fast-reasoning,
        grok-4-1-fast-non-reasoning. Each model interprets tools differently.
        A feature that works on gpt-5 may break on grok. You need to know.
        If it passes on all models, close the issue AND add the label
        "devloop-validated". If it fails on a specific model, file a new issue.
        Update your status in the GitHub issues as you go.

  TOK — RE-VALIDATE: Pick a closed issue that lacks the "devloop-validated"
        label. Read the issue and the code behind it. Send prompts through
        devloop_roundtrip that exercise that feature — one prompt per model.
        If it passes everywhere, add the "devloop-validated" label and leave
        a comment with the evidence (correlation tags, model names, pass/fail).
        If it fails on any model, reopen the issue or file a new one with
        the failure details. Then go back to TIK.

Use Playwright MCP for visual verification in the browser when needed (but
NEVER to type into Teams — only screenshots and visual inspection). Pull logs
from the running Azure infra (AppInsights via Invoke-AzOperationalInsightsQuery)
when relevant. Don't mark anything as done unless you have tested it and it is
functionally verified. Really understand what you are testing.

When both backlogs run dry — no open issues AND no closed issues without the
"devloop-validated" label — shift to discovery mode:

  1. Use devloop_roundtrip to talk to HelkinSwarm. Ask it what tools it sees,
     what it understands, what confuses it, what fails. Compare its answers to
     the source code. Every gap or failure mode becomes a new GitHub issue.

  2. Use devloop_interrogate to probe each model individually. Each model may
     misunderstand tools differently. Optimisations for one model may need to
     be tailored for another. File issues for model-specific quirks.

  3. Ask HelkinSwarm about its memories, its understanding of the user, what
     patterns it has noticed. Compare this to what the code actually stores.
     If there are gaps between what it thinks it knows and what it actually
     knows, file issues to fix the memory layer.

  4. Review the codebase for stale patterns, dead code, missing error handling,
     type safety gaps, inconsistent naming. File issues for anything you find.

  5. Check the .github/instructions/ files against the actual codebase — are
     they still accurate? File issues for drift.

  6. Run the zombie process check (scripts/Remove-VSCodeZombieProcesses.ps1
     -ListOnly) every 2 hours during long sessions. Clean up if count > 10.

Every discovery cycles back to the top: new issues exist → TIK-TOK resumes.
The loop never ends as long as there is something to improve.

Never stop to ask me a question. If something is ambiguous, make the best
decision you can, document your reasoning in the issue comment, and keep moving.
If you hit a genuine blocker (permissions, infrastructure, human-approval gate),
document it in the issue, move to the next item, and come back later.

Run like this in a loop until you get all the things done, or die trying.
```

---

## What This Prompt Does

The loop has three modes that cycle forever in a Tik-Tok pattern:

```
    ┌──────────────────────────────────────────┐
    │                                          │
    │  TIK — DELIVER                           │
    │  Pick open issue → implement → push →    │
    │  deploy → validate on ALL models →       │
    │  close + "devloop-validated" label        │
    │              │                           │
    │              ▼                           │
    │  TOK — RE-VALIDATE                       │
    │  Pick closed issue without label →       │
    │  exercise on ALL models → pass? add      │
    │  label. fail? reopen/file new issue      │
    │              │                           │
    │              ▼                           │
    │         back to TIK                      │
    │                                          │
    │  When both backlogs empty ↓              │
    │                                          │
    │  DISCOVERY                               │
    │  Interrogate bot × each model →          │
    │  audit code → audit docs → find gaps →   │
    │  file new issues → ↑ back to TIK         │
    │                                          │
    └──────────────────────────────────────────┘
```

### Key concepts:

- **Tik-Tok alternation** — never work in a vacuum. After delivering something
  new, re-validate something old. This catches regressions and ensures every
  feature works across all deployed models, not just the default EU one.

- **All models at the party** — gpt-5, o4-mini, o3, gpt-5-mini,
  grok-4-1-fast-reasoning, grok-4-1-fast-non-reasoning. Each interprets tools
  differently. A feature validated on one model is NOT validated on all.

- **`devloop-validated` label** — the quality seal. An issue only gets this
  label after the feature has been verified working across all deployed models.
  Issues without this label are fair game for re-validation in the TOK beat.

- **Discovery generates work** — when both backlogs are empty, the agent
  interrogates each model, audits code and docs, and creates new issues.
  Those issues feed back into TIK-TOK. The loop is self-sustaining.
