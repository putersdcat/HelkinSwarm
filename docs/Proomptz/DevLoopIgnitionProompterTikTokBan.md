Use the GitHub MCP tooling to pull all open issues for putersdcat/HelkinSwarm.
After reviewing the open issue bodies, read the ones with long comment chains to
determine what is actually still open versus already resolved in comments but not
yet reflected cleanly in code or issue state. Build a prioritised worklist (in
context) based on impact to the overall project and hard dependencies.

Do **not** spend time running a broad re-certification sweep across previously
closed backlog items. The open issue pile is already too large, delivery pace is
too slow, and token burn is too high relative to what has actually shipped. Closed
issues may still be searched when relevant to an active open issue, but they are
not the main work queue.

When beginning work on any open issue, run a related keyword search across closed
issues to surface prior context, partial implementations, regressions, or hidden
dependencies that may still matter.

---

**Execution Tempo: Open-Issue Blitz**

Primary mode is relentless forward delivery against the current open queue.

- If open issues exceed 25: stay in **Blitz Mode**
- If open issues exceed 40: stay in **Hard Blitz Mode**

In both modes, default behaviour is:

1. pull the next highest-value open issue
2. read the real code fully
3. implement
4. commit and push
5. wait for deploy
6. validate the shipped behaviour
7. update the GitHub issue with evidence
8. move directly to the next open issue

Do **not** interrupt momentum to re-audit old closed work unless:

- it directly blocks the current open issue
- it appears to have regressed and is causing the current failure
- the user explicitly asks for a validation sweep

The goal is to reduce the active open pile first, because that is currently the
highest-value path.

---

**DELIVER — default loop**

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

Then immediately move to the next open issue.

---

**NO BACKLOG RE-CERTIFICATION SWEEP**

Do not spend cycles pulling closed issues that are missing the "devloop-validated"
label just to clean up bookkeeping. That work is lower priority than shipping the
still-open feature and bug backlog.

Treat closed issues as reference material, not as the main execution queue.

The only time to re-open or re-test a closed item proactively is when one of the
following is true:

1. an open issue clearly depends on it
2. the current behaviour suggests regression
3. comments claim it is done but live code inspection says otherwise
4. the user explicitly requests a re-validation pass

Outside those cases, keep pushing the open queue down.

---

**Token and Cost Discipline**

Token costs are high and progress has been glacial. Operate accordingly.

- Prefer direct code/file inspection over sprawling speculative research
- Do not run giant validation sweeps unless they are clearly justified
- Reuse context aggressively within the current issue before branching outward
- Keep issue comments evidence-rich but concise
- Avoid “ceremonial” work that produces status theater instead of shipped value
- Bias toward changes that collapse multiple open issues or unlock blocked clusters

The standard is not “maximum process purity.” The standard is **useful shipped
progress per unit token and time**.

---

**Validation and Evidence**

Validation still matters. The change is that validation should be tightly coupled
to active delivery, not expanded into a parallel cleanup program.

For each issue being delivered:

- validate the real shipped behaviour
- gather evidence from the correct source
- update the issue with what was tested and what passed/failed
- do not mark anything done unless it is functionally verified

Use:

- helkinswarm-teams-test MCP for conversational E2E
- Playwright MCP for visual/browser verification when needed
- Azure/AppInsights/Operational Insights queries for runtime evidence

Never use Playwright to type into Teams. Screenshots and visual inspection only.

---

**Priority Heuristics**

When choosing the next open issue, prefer this order:

1. issues that unblock many other issues
2. issues that fix broken core product surfaces already visible to the user
3. issues that reduce operational drag, cost, or deployment instability
4. issues that complete half-built features already partly shipped
5. issues that improve secondary polish after the above are under control

Examples of high-priority work:

- broken or embarrassing Teams surfaces
- missing wiring where the issue/body/spec says something exists but code does not
- cost and infra leaks
- auth or deployment blockers
- half-implemented skills or tabs with visible user impact

Examples of lower-priority work for now:

- retrospective re-certification passes on old closed items
- broad archive cleanup with no current user impact
- low-value status gardening

---

**When the open queue is finally under control**

Only once the open issue pile has been materially reduced should you widen back
out into deeper validation and discovery passes.

At that point, optionally resume:

1. targeted re-validation of high-risk previously closed work
2. discovery mode against HelkinSwarm behaviour
3. model-specific interrogation for quirks
4. stale-code and drift audits
5. instruction/spec drift checks

But not before the open queue stops actively piling up.

---

Never stop to ask for clarification. If something is ambiguous, make the best
decision possible, document your reasoning in the issue comment, and keep moving.
You have the tools and the authority — no artificial blockers are acceptable.

Run this loop continuously against the open issue backlog until it is crushed —
or die trying.