# Remaining Work Assessment — 2026-04-04

This follow-up records where delivery now stands relative to `09-Backlog-Control-Surface.md`, the issues spun out since that control surface was written, and the current code state in the repo.

It is intentionally evidence-based rather than aspirational.

---

## Executive summary

### Short version

The **Living Mind constitutional gate is much narrower than it was on 2026-04-02**, but it is **not cleared yet**.

A large amount of first-wave constitutional work has already shipped and closed, including:
- cognitive-capacity / impairment routing (`#525`)
- autonomic sub-session preservation (`#526`)
- enforced limbic ingress lifecycle (`#527`)
- steering injection, chrono continuity, interruption breadcrumbing, depth-cap behavior, paused-task paging seams, and the safe `awaiting-ingress` drain window (multiple child slices under `#498` / `#520`)

What remains is no longer broad constitutional vagueness. It is now concentrated in the **hard single-session/event-drain seam**:
- `#516`
- `#520`
- `#554`
- `#555`
- `#556`

The deepest currently exposed blocker is `#556`.

### Is the end in sight soon?

**There is an end shape in sight for the first-wave constitutional tranche, but I would not call it "nearly done" yet.**

Why:
- The remaining problem is now very specific.
- But it sits in the center of the runtime’s active-session event-delivery model.
- That means the next fix could be small **or** it could force a deeper architectural adjustment in `src/orchestrator/overseer.ts`.

My honest read:
- **Best case:** the constitutional gate is only a small number of real slices away.
- **Worst case:** `#556` proves the current active-processing delivery assumption is wrong, and the runtime needs a more substantial redesign for active-session message buffering / drain semantics.

So: **the end is visible, but not yet safely schedulable as “soon.”**

---

## What is stale in the original control surface

The original `09-Backlog-Control-Surface.md` is now partially out of date.

### Constitutional section drift

The file still lists these as active clearest child slices:
- `#525`
- `#526`
- `#527`

That is now stale.

Current GitHub state:
- `#525` — **closed**
- `#526` — **closed**
- `#527` — **closed**

### Zone A drift

The file still lists:
- `#480` as an open Zone A runtime bug

Current GitHub state:
- `#480` — **closed**

### Trust Recovery drift

The control surface implicitly treats `#484` as a still-open concept gap.

Current repo state shows it is **partially delivered in code already**:
- `src/capabilities/capabilityLoader.ts:300` — `getSkillCatalog()` now computes `operationalState` and `operationalSummary`
- `src/capabilities/capabilityLoader.ts:352` — `inspectSkillInstall()` now returns richer install states instead of only blunt ready/blocked semantics
- `src/capabilities/skillOperationalState.ts:56` — explicit `operator-setup-required` support exists
- `tabs/app.js:1458` and `tabs/app.js:1487` — the Skills tab renders operational badges
- `tabs/app.js:1467` and `tabs/app.js:1491` — operational summaries are shown in the UI

That does **not** prove `#484` is closeable today, but it does mean the control surface understates how much of that issue has already been delivered.

---

## What has actually been delivered under the constitutional gate

This is the clearest reason the remaining work is narrower than it looks from the original control surface.

### Closed constitutional children now verified

- `#525` — **closed**
  - code now includes model cognitive-capacity profiles and impairment semantics
  - evidence in `src/llm/modelRouter.ts`
    - `ModelCapacityProfile` at `line 65`
    - `MODEL_CAPACITY_PROFILES` at `line 95`
    - `selectRestoredConsciousLaneDeployment(...)` at `line 213`
    - `getConsciousLaneAssessment(...)` at `line 313`

- `#526` — **closed**
  - issue status closed, preserving autonomic/instrumental sub-sessions as allowed under the contract

- `#527` — **closed**
  - the enforced limbic lifecycle issue is closed
  - the active routing paths still call `recordLimbicIngressDecision(...)`
    - `src/bot/HelkinSwarmBot.ts:1186`
    - `src/orchestrator/pendingIntentReplay.ts:132`

### Additional shipped constitutional bridge work

The current issue tree also shows that multiple major bridge slices already closed under `#498` / `#520`, including:
- steering injection compatibility seam (`#502`)
- chrono continuity seam (`#504`)
- interruption breadcrumb seam (`#509`)
- interruption depth cap seam (`#511`)
- paused-task paging/resume seam (`#515`)
- explicit `awaiting-ingress` drain window (`#521`)
- later ordinary Teams safe-window reroute work (`#549`, `#552`)

The code confirms the architectural pieces exist:
- `src/orchestrator/overseer.ts:107` — explicit ingress window open action
- `src/orchestrator/overseer.ts:115` — `waitForExternalEvent('NewMessage')`
- `src/orchestrator/sessionOrchestrator.ts:347` — context-aware routing message construction
- `src/orchestrator/sessionOrchestrator.ts:368` and `:381` — quoted context threaded into steering/prompt paths

### Bottom line

The first-wave constitutional work is **not** “unstarted.”

It is already in the late, ugly phase where the remaining bugs are **runtime-behavior seams** rather than missing major components.

---

## What still remains under the constitutional campaign

This is the active remaining stack as of 2026-04-04.

### 1. `#556` — current deepest blocker

**Title:** Raised `NewMessage` events are not later drained when sent to an active-processing living overseer

This is currently the most important remaining issue in the constitutional chain.

#### Why it matters

It directly challenges the assumption that an already-active living overseer can safely accept follow-on same-identity work during active processing.

#### Current repo evidence

`src/orchestrator/overseer.ts` only starts waiting on external follow-on events **after** `processTurn(...)` returns:
- `src/orchestrator/overseer.ts:115` — `waitForExternalEvent('NewMessage')`
- the ingress window is only opened after the turn completes (`line 107` action open)

That means the runtime is not explicitly waiting on `NewMessage` while a leader turn is still active-processing.

#### Current live evidence

Per `#556`, a live injected follower turn was accepted as delivered to the active overseer, but never later showed:
- `LivingSessionNewMessageDrained`
- `ReplySent`
- any visible final reply

That is the strongest remaining architectural blocker.

#### Assessment

This is the issue most likely to determine whether the remaining constitutional work ends quickly or explodes into a deeper redesign.

---

### 2. `#555` — shipped improvement, but not yet closure-worthy

**Title:** Fix drained living-session turns to use unique session sub-orchestrator instance IDs

This issue is **partially delivered in code**, but still open because live proof failed.

#### What is already true in code

The fix shipped on trunk:
- `src/orchestrator/overseer.ts:206`
  - `const sessionInstanceId = \`session-${context.df.instanceId}-${sessionInput.correlationId}\`;`

That is better than the previous reused per-overseer session sub-orchestrator ID.

#### Why it is still open

Live proof showed that this was **not sufficient** to restore real drained follower behavior.

#### Assessment

`#555` is probably not the root remaining problem anymore.
It is better viewed as:
- a shipped corrective improvement
- that may become closeable after `#556` is resolved
- or may need to be superseded as a contributing seam rather than the primary blocker

---

### 3. `#554` — ordinary Teams overlap still not safely redirected outside `awaiting-ingress`

**Title:** Redirect ordinary Teams overlap into active living session outside awaiting-ingress window

This remains a user-visible seam.

#### Current repo evidence

In `src/bot/HelkinSwarmBot.ts`, ordinary Teams overlap is still stage-gated to the narrow proven-safe ingress window:
- `src/bot/HelkinSwarmBot.ts:1170` — `activeSessionRoutable = hasActiveGuard ...`
- `src/bot/HelkinSwarmBot.ts:1172` — routable only when an entry is at stage `awaiting-ingress`
- `src/bot/HelkinSwarmBot.ts:1233` — authority `living-session-awaiting-ingress-redirection`

By contrast, pending-intent replay is broader:
- `src/orchestrator/pendingIntentReplay.ts:119` — active session routable whenever an active instance exists
- `src/orchestrator/pendingIntentReplay.ts:191` — authority `living-session-active-redirection`

#### Assessment

`#554` is still real, but I would **not** attack it first.

If `#556` is unresolved, retrying broader ordinary Teams redirection risks repeating the same failed outside-in behavior on a more user-visible path.

So `#554` is now more of a **dependent seam** than the deepest blocker.

---

### 4. `#520` — the architectural parent is still open honestly

**Title:** Replace one-shot overseer ingress with a true event-draining living session

This is still the right parent framing for the active constitutional runtime gap.

#### Why it is still open

Even though the overseer now has a multi-turn loop and an explicit ingress window, the runtime still does **not** yet prove a reliable event-draining active session for same-identity work during active processing.

#### Assessment

`#520` will not close until `#556` is resolved and the live runtime proves that same-identity work can really be drained and replied to on the current living session path.

---

### 5. `#516` — hard single-session enforcement is not complete yet

**Title:** Flip MindSessionGuard from compatibility seam to hard single-session enforcement

This is still the real constitutional “done done” gate.

#### Current repo evidence

The repo still preserves compatibility-mode behavior rather than true hard enforcement:
- `src/bot/HelkinSwarmBot.ts:1186` — limbic decisioning is active, but ordinary overlap still falls back to queue outside the safe window
- `src/orchestrator/pendingIntentReplay.ts:119` / `:191` — redirection exists on some paths, but not as a universal hard single-session model
- issue `#516` remains open because `compat-start` / compatibility-mode semantics are still part of the runtime story

#### Assessment

`#516` is unlikely to close directly.
It should close only **after** the `#520`/`#556` event-draining problem is solved and live proof can show a single living session invariant instead of compatibility-managed behavior.

---

### 6. `#498` — still open because the final enforcement tranche is not yet complete

This parent is much closer than it was on 2026-04-02, but it is still not honestly closable.

#### What is already done

Most of the first-wave components are now in code and many child issues are closed.

#### What still blocks closure

At minimum:
- reliable active-processing drain/reply semantics (`#556`)
- ordinary Teams overlap outside the narrow safe window (`#554`) or an honest re-bucketing of that path
- final hard single-session enforcement (`#516`)

---

## Trust Recovery campaign: where that stands now

The constitutional gate still outranks Zone A when blocked issues depend on it. But several Zone A items are worth reassessing because the code has moved since the original control surface.

### `#484` — partially delivered already

**Issue:** Distinguish loaded/installed from operational state in Skills Library and readiness UX

#### Current repo evidence

Backend:
- `src/capabilities/capabilityLoader.ts:300` — `getSkillCatalog()`
- `src/capabilities/capabilityLoader.ts:322-323` — emits `operationalState` and `operationalSummary`
- `src/capabilities/capabilityLoader.ts:352` — `inspectSkillInstall()`
- `src/capabilities/capabilityLoader.ts:379` — returns `status: assessment.operationalState`

State model:
- `src/capabilities/skillOperationalState.ts:56` — `operator-setup-required`
- `src/capabilities/skillOperationalState.ts:64` — explicit `/link` action step
- `src/capabilities/skillOperationalState.ts:82-83` — explicit user-action/operator-setup messaging

UI:
- `tabs/app.js:1458` — renders operational badge on catalog cards
- `tabs/app.js:1467` — renders operational summary
- `tabs/app.js:1470` — shows operational row in metadata
- `tabs/app.js:1487` and `:1491` — same on manage cards

#### Remaining gap

The UI still also shows `Installed` / `Loaded` badges:
- `tabs/app.js:1457` — `Installed`
- `tabs/app.js:1486` — `Loaded`

So the issue looks more like **UX semantics are mixed**, not “operational state model missing entirely.”

#### Assessment

`#484` is **closer than the original control surface suggests**.
It likely needs a review/narrowing pass, not a greenfield implementation.

---

### `#485` — partially bridged, not yet proven

**Issue:** Follow-up skill verification drifts into health/discovery prose instead of execution proof

#### Current repo evidence

The repo now does more than prompt-only quoted context:
- `src/orchestrator/sessionOrchestrator.ts:347` — `buildContextAwareRoutingMessage(...)`
- `src/orchestrator/sessionOrchestrator.ts:428` — `synthesizeDeterministicReadOnlyInitialToolCall(...)`
- quoted context is threaded structurally into orchestration paths at `:368` and `:381`

The deterministic follow-up helper has explicit execution-proof heuristics:
- `src/orchestrator/discoveryToolInjection.ts:105` — `isExecutionProofPrompt(...)`
- `src/orchestrator/discoveryToolInjection.ts:258` — `parseDeterministicSkillVerificationIntent(...)`
- `src/orchestrator/discoveryToolInjection.ts:288-291` — Outlook proof prompts can synthesize `outlook_search_emails`

#### Remaining gap

This is still heuristic-first, not a universally proven deterministic continuity model.
The issue remains open because the fix still needs deployed E2E proof in the exact scenarios that previously drifted.

#### Assessment

`#485` is **not untouched**.
It looks like a partially implemented routing-hardening issue that still needs live validation and perhaps narrowing.

---

### `#479` — likely partially improved, but still not honestly proven closed

**Issue:** Outlook read/search validation drifts into discovery metadata instead of executing mailbox tools

#### Current repo evidence

The repo does now include deterministic Outlook execution shortcuts:
- `src/orchestrator/discoveryToolInjection.ts:289-291` — returns `outlook_search_emails`
- `src/orchestrator/discoveryToolInjection.ts:746-747` — forced function choice for search/look-up shapes
- actual mailbox handlers remain implemented in `skills/outlook/handlers.ts`

#### Remaining gap

The issue remains open because the product still needs live E2E proof on the active model lanes that the mailbox tool path executes instead of drifting back into discovery/describe output.

#### Assessment

Like `#485`, this feels closer to **validation-and-polish** than to greenfield design, but it is still open honestly until live proof is rerun.

---

### `#480` — already done

This one is closed and should be removed from the live control surface the next time the control surface is refreshed.

---

## Blocked downstream work still waiting on `#498`

A large amount of backlog pressure is still constitutionally downstream of the unfinished single-session runtime.

Representative open issues that remain blocked or materially constrained by `#494` / `#498` include:
- `#103` — virtual employee persona/capability restrictions
- `#238` — deep research / extended research
- `#244` — AI-native lightweight document storage (VE execution aspects)
- `#249` — revenue discovery primitive for the virtual company
- plus the broader Virtual Employee / virtual-company expansion stack named on `#498`

This is why the constitutional campaign still matters: it is blocking a lot more than just overlap-routing cosmetics.

---

## Real path to the end from here

### Path to end of the constitutional first wave

The next honest path is:

1. **Fix `#556` first**
   - make active-processing `NewMessage` delivery actually drain later on the same overseer
   - prove this with owner-only relay injection and runtime trace

2. **Then revisit `#554`**
   - only after active-processing drain is trustworthy
   - retry the broader ordinary Teams redirect outside the safe `awaiting-ingress` window

3. **Then collapse `#520`**
   - once same-instance drain is proven in both helper and ordinary Teams paths

4. **Then close `#516`**
   - remove the remaining compatibility-managed story and prove the single living session invariant

5. **Then close `#498`**
   - once the first-wave enforcement contract is honestly complete

### What could make this go quickly

If `#556` turns out to be a small fix in how active-session delivery is buffered/consumed, the remainder of the constitutional gate could shrink fast.

### What could make this take longer

If `#556` exposes a deeper Durable limitation in the current overseer model, the runtime may need a more explicit mailbox/queue architecture for active-session follow-on work rather than the current assumption that a raised event will naturally drain later.

That would be a deeper redesign.

---

## Overall assessment

### Where we stand now

- The original control surface was directionally right, but is now status-stale.
- The constitutional campaign has already delivered **most of the first-wave scaffolding and many concrete behaviors**.
- The remaining work is concentrated in the **last hard runtime continuity seam**, not in broad missing foundations.
- Trust Recovery is partly blocked and partly already overtaken by code progress.

### Is an end in sight?

**Yes, the end shape is visible.**

But the honest qualifier is:
- **for the constitutional first wave:** maybe soon, depending almost entirely on `#556`
- **for the whole control surface:** not yet, because Trust Recovery and Enterprise Readiness still remain after the constitutional gate clears

### My practical conclusion

The work is no longer sprawling in every direction.
It has condensed into a small number of highly specific runtime seams.

That is good news.

But one of those seams (`#556`) sits directly under the heart of the living-session design, so I would treat it as the decisive test of whether this wave is in its final stretch or still one architectural turn away.

---

## Suggested next refresh to the control surface

When `09-Backlog-Control-Surface.md` is next updated, I would change at least the following:

- remove `#525`, `#526`, `#527` from “active now” and mark them delivered
- remove `#480` from open Zone A
- note that `#484` is partially delivered in code and may need re-bucketing
- replace the top constitutional execution focus with the current live stack:
  - `#516`
  - `#520`
  - `#556`
  - `#554`
  - `#555` (possibly as a dependent/subordinate seam rather than the main next target)

That would better match the repo and issue reality as of 2026-04-04.
