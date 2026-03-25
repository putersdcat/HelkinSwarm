Use the GitHub MCP tooling to pull all open issues for putersdcat/HelkinSwarm.
After reviewing each issue body, read any long comment chains to determine what
is actually still open versus already resolved. Build a prioritised worklist
(in context) based on impact to the overall project and dependencies between items.

Also pull closed issues that do NOT have the label "devloop-validated". These are
delivered features that were only minimally validated — they need re-testing
against the relevant active models to confirm they work as expected.

When beginning work on any open issue, also run a related keyword search across
closed issues — even ones already labelled "devloop-validated" — to surface prior
context that may still be relevant or that extends the work being done.

---

**Adaptive Tempo:**
Default pattern is strict alternating TIK-TOK. When total open issues exceeds 25,
switch to DnB mode: TIK, TIK, TOK (2 deliveries per 1 re-validation). This
preserves forward momentum while preventing the validation backlog from growing
uncontrolled. Return to strict TIK-TOK once open issues drop back below 25.

---

**TIK — DELIVER**

Pick the top open issue. Read the code fully and understand it completely before
touching anything. Implement the change, commit, push, and wait for deployment.
Validate the deployed change using the helkinswarm-teams-test MCP — send chat
messages via devloop_roundtrip that exercise the feature end-to-end.

Test against the relevant models for the feature: always start with the primary
and secondary active models. For domain-specific skills, focus on the model(s)
that are the actual target for that domain. Only extend to additional actively
deployed models if there is specific reason to suspect model-specific behaviour.
Do not blindly test every deployed model — some are domain-specific or not yet
active for general use. Comprehensive cross-model tuning is a separate concern.
If it passes on all tested models, close the issue and apply the
"devloop-validated" label. If it fails on any model, file a new issue with full
failure details and evidence. Update the GitHub issue with status as you go.

---

**TOK — RE-VALIDATE**

Pick a closed issue missing the "devloop-validated" label. Read the issue and the
actual code behind it. Send prompts through devloop_roundtrip that exercise the
feature — test against the primary and secondary active models, plus any
domain-relevant models for the feature being validated. If it passes on all
tested models, add the "devloop-validated" label and comment with evidence
(correlation tags, model names, pass/fail results). If it fails on any model,
reopen the issue or file a new one with full failure details. Return to TIK.

---

**Telemetry:** Pull logs from Azure AppInsights via
Invoke-AzOperationalInsightsQuery to verify expected code paths are being hit and
to gather evidence for issue comments. If that script is not in the repo, write
it — it should be straightforward. Use Playwright MCP for visual verification in
the browser when needed, but NEVER to type into Teams — screenshots and visual
inspection only. Do not mark anything done unless it is functionally verified.
Really understand what you are testing.

---

When both backlogs run dry — no open issues AND no closed issues without
"devloop-validated" — shift to **Discovery Mode**:

  1. Use devloop_roundtrip to talk to HelkinSwarm. Ask what tools it sees, what
     it understands, what confuses it, what fails. Compare its answers to the
     source code. Every gap or discrepancy becomes a new GitHub issue.

  2. Use devloop_interrogate to probe each model individually. Each model may
     misinterpret tool schemas differently. Optimisations for one model may need
     tailoring for another. File issues for model-specific quirks.

  3. Ask HelkinSwarm about its memories: what it understands about the user, what
     patterns it has noticed. Compare what it thinks it knows to what the code
     actually stores. File issues for any gaps in the memory layer.

  4. Audit the codebase for stale patterns, dead code, missing error handling,
     type safety gaps, and naming inconsistencies. File issues for everything found.

  5. Compare .github/instructions/ files against the current implementation.
     File issues for any drift.

  6. Run the zombie process check (scripts/Remove-VSCodeZombieProcesses.ps1
     -ListOnly) every 2 hours during long sessions. If zombie count exceeds 10,
     run cleanup with -IdentifyOrphansOnly -GracefulShutdown -MinIdleMinutes 15.

Every discovery item feeds back into TIK-TOK. The loop is self-sustaining and
continues indefinitely as long as improvements are possible.

---

Never stop to ask for clarification. If something is ambiguous, make the best
decision possible, document your reasoning in the issue comment, and keep moving.
You have all the rights and all the tools — no blockers are acceptable. Worst
case, use Playwright MCP for interactive browser access to unblock yourself.

Run this loop continuously until everything is done — or die trying.