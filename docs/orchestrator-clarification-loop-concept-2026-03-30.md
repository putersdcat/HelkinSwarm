# Orchestrator Clarification Loop Concept — 2026-03-30

## Status of this document

This document is the **historical design reference** for a new orchestrator-facing clarification capability: a core tool / behavior that lets HelkinSwarm ask targeted follow-up questions when the request is ambiguous, underspecified, or cannot yet be safely routed to the correct tool.

It is not implementation documentation yet. It is the design anchor for backlog work.

Related backlog stack:

- `#405` — epic: orchestrator clarification loop for ambiguous or underspecified requests
- `#406` — research: Teams UX options for orchestrator clarification loops
- `#407` — architecture: clarification-loop state model and core capability contract
- `#408` — feature: implement first usable orchestrator clarification loop in Teams

## Problem statement

Today, when a request is not well defined, a tool cannot be selected confidently, or the orchestration layer is otherwise uncertain, HelkinSwarm can degrade into poor UX such as:

- a generic fallback like `I processed your request but have nothing to report back.`
- a silent-feeling dead end after the placeholder / ack phase
- too much guesswork by the orchestrator when a quick user clarification would unblock progress

This is especially undesirable because the product already has a strong placeholder / ack lifecycle and should evolve toward more graceful, stateful, interactive refinement instead of brittle failure.

## Core idea

Introduce a new **clarification loop** capability, conceptually similar to how `helkin_skill_search` acts as a core discovery tool.

This clarification capability is meant primarily for the orchestrator and other top-level reasoning paths.

Its purpose is to:

- detect when the request is underspecified or routing confidence is low
- formulate the minimum clarifying question(s) needed to unblock action
- deliver those questions back to the user through an interaction surface that fits Teams well
- resume the suspended orchestration path once the user answers

In other words, instead of giving up, the system should be able to say:

- “Do you want me to use your Outlook calendar or create a tentative event only in-chat?”
- “Which repository do you mean?”
- “Should I send this to John Smith in Outlook or John Smith in Teams?”
- “I found two plausible tools. Which direction do you want?”

## Conceptual architecture

### 1. Core clarification capability

This should likely exist as a **core skill / tool / orchestration primitive**, not as an ad-hoc bot-side special case.

A likely conceptual name is something in the family of:

- `helkin_request_clarification`
- `helkin_clarify_request`
- `helkin_refine_request`

The exact name can be decided later, but the important part is the contract.

The capability should allow the orchestrator to emit a structured clarification payload such as:

- why clarification is needed
- what uncertainty category applies
- what question(s) should be shown
- whether the response should be free text, single choice, multi-choice, or richer form input
- how the suspended orchestration turn should be resumed after the answer returns

### 2. Clarification state model

This feature needs explicit turn-state handling, not just a message prompt.

The system should track:

- original request
- correlation ID / placeholder ownership
- clarification request ID
- clarification mode (text/card/dialog)
- expected answer shape
- timeout / abandonment behavior
- resume path once the answer arrives

This should be treated as a first-class orchestration state transition:

`accepted -> needs clarification -> awaiting answer -> resumed -> terminal outcome`

## Relationship to existing HelkinSwarm behavior

This concept should build on existing repo-grounded behavior, not replace it.

### Existing infrastructure that already helps

- `docs/10-Teams-Interface.md` already defines the ack → update pattern
- `#267` delivered correlated spinner / placeholder lifecycle work
- `#373` established that every accepted query must resolve its placeholder with a terminal outcome
- `src/bot/HelkinSwarmBot.ts` already has:
  - pending ack storage
  - `updateActivity(...)` usage
  - `onAdaptiveCardInvoke(...)` handling for Action.Execute flows
- `src/bot/confirmationCards.ts` already proves the bot can round-trip Adaptive Card button actions

### What is still missing

I do **not** see a dedicated clarification-loop contract in repo docs or backlog today.

I also do **not** see a current orchestrator path that can intentionally move a turn into an explicit `awaiting clarification` state instead of degrading into generic no-op text when confidence is low.

## Teams interaction research — what appears viable

Research grounded in Microsoft Learn and official sample repositories suggests three viable UX layers.

### A. Inline text clarification — simplest baseline

The system can replace or follow up on the placeholder with a short clarifying text question and wait for the user’s next message.

Pros:

- simplest implementation
- no special client UX required
- compatible with existing bot message flow

Cons:

- weaker structure
- harder to validate response shape
- worse for disambiguation or multi-step refinement

### B. Adaptive Card clarification workflow — likely best default

Microsoft guidance shows that Teams bots can use:

- `Action.Execute`
- `adaptiveCard/action` invoke handling
- sequential card workflows
- updated cards returned in-place

This appears to be the strongest fit for **short structured clarification** such as:

- pick one of 2–5 options
- confirm assumptions
- fill one or two small fields
- answer a guided follow-up in the same message slot

Why this looks promising:

- official docs support returning an updated card immediately on `Action.Execute`
- sequential workflows are explicitly supported for step-by-step progression
- HelkinSwarm already has bot-side Adaptive Card invoke plumbing
- the product already values in-place placeholder resolution and correlated message updates

### C. Dialog / task-module flow — best for heavy clarification only

Microsoft guidance indicates dialogs are often a better UX than many chat turns when the task is complex.

This is a good fit for:

- larger forms
- richer contextual review before user choice
- branching clarification that would be clumsy in chat

But dialogs likely should be the **exception**, not the default, because this concept is primarily about quick refinement, not launching a mini-app every time the orchestrator gets nervous.

## Current best refined product idea

### Recommended interaction hierarchy

#### Tier 1 — text clarification fallback
Use plain text when:

- only one quick follow-up is needed
- no structured input is required
- Teams card/dialog overhead would be excessive

#### Tier 2 — in-place Adaptive Card clarification (recommended default)
Use an in-place updated card when:

- the ambiguity can be resolved by structured input
- the answer benefits from explicit choices or small fields
- the orchestrator wants to keep the clarification attached to the original placeholder lifecycle

This is currently the most attractive default target.

#### Tier 3 — dialog for complex refinement
Use a dialog only when:

- the clarification needs several fields
- the user would benefit from a focused form
- the interaction is too complex for a simple card sequence

## Suggested first implementation slice

The smallest strong first slice would be:

1. add a clarification-loop orchestration state
2. add a core clarification capability contract
3. when the orchestrator is uncertain, update the original placeholder into:
   - a short clarifying question, or
   - a simple Adaptive Card with 1–3 options / small inputs
4. resume the original workflow after answer submission
5. ensure timeout / cancellation still resolves the placeholder cleanly

This would be a large UX improvement without immediately requiring the full dialog path.

## Suggested capability shape

A likely structured response from the clarifier capability could include fields like:

- `reason`: `missing_required_parameter | ambiguous_target | low_routing_confidence | safety_boundary | execution_mode_choice`
- `questionTitle`
- `questionText`
- `answerMode`: `text | single_choice | multi_choice | small_form | dialog`
- `choices`
- `resumeHint`
- `timeoutBehavior`

The orchestrator would not directly ask arbitrary prose every time. Instead, it would ask through a constrained contract that the Teams surface can render predictably.

## Important design constraints

- this feature must **not** leave the placeholder unresolved
- it must integrate with the ack/update lifecycle rather than bypass it
- it should minimize user annoyance by preferring the smallest possible clarification
- it must resume the original task rather than forcing the user to restate everything
- it should log enough telemetry to distinguish:
  - clarification requested
  - clarification answered
  - clarification abandoned
  - clarification resolved routing successfully
  - clarification failed to resume action

## Relationship to adjacent work

### Strongly related

- `#373` — every accepted query must resolve its placeholder with a terminal outcome
- `#267` — correlated spinner lifecycle into ack/update flow
- `#394` — discovery-first calendar routing currently degrades into generic no-op behavior instead of a better clarification/resolution path

### Why this is different

Those issues improve placeholder behavior and concrete routing failures.

This concept introduces a **general reusable mechanism** for turning orchestrator uncertainty into a graceful, user-visible clarification loop.

## Research findings worth carrying forward

### Microsoft Learn

Research suggests the most relevant Teams primitives are:

- **bot message updates** via `updateActivity` for in-place placeholder replacement
- **Universal Actions / `Action.Execute`** for immediate card updates and structured bot round-trips
- **Sequential Workflows** for guided multi-step card flows
- **Dialogs / task modules** for more complex forms when chat/card UX is insufficient

### Official sample direction

Official samples and repos indicate that Microsoft’s sample ecosystem already contains examples for:

- bot dialog / task-module fetch/submit flows
- sequential Adaptive Card workflows
- message update patterns
- card action handlers in Teams-focused samples

That is a strong sign that HelkinSwarm should not invent a completely novel Teams interaction pattern when the platform already supports these building blocks.

## Refined recommendation after initial research

Based on the current Microsoft guidance and sample landscape, the current best recommendation is:

1. **use plain text clarification as the universal fallback**
2. **target in-place Adaptive Card clarification as the primary structured path**
3. **defer dialog-heavy flows unless the research/architecture phase proves they are needed for the first slice**

Why this looks strongest right now:

- HelkinSwarm already has correlated ack / placeholder ownership and message update machinery
- Teams explicitly supports message updates for bot messages
- Teams supports `Action.Execute` and updated-card responses for quick structured back-and-forth
- sequential card workflows appear to fit short clarifying loops better than launching a modal for every ambiguity
- dialogs remain available later for heavier form-like refinement when needed

## Proposed backlog structure

This concept is best represented as a **parent issue + three-part child stack**:

1. research Teams clarification UX primitives and recommended HelkinSwarm fit
2. design the core clarification capability + orchestration state contract
3. implement the first usable clarification loop in Teams and orchestrator flow

## Initial recommendation

If implemented incrementally, the first target should be:

- orchestrator-driven clarification state
- in-place placeholder replacement
- Adaptive Card-based quick clarification as the preferred structured path
- plain-text fallback when cards are unnecessary
- dialogs deferred unless the research phase proves they are needed for the first slice

## First implemented v1 contract

The first usable shipped slice is intentionally narrower than the full concept above.

### Implemented answer mode

- `text`

Adaptive Card and dialog-based clarification remain future work.

### Implemented state shape

The current first-pass orchestration state now carries a persisted pending clarification record with fields in this family:

- `id`
- `reason`
- `questionText`
- `answerMode`
- `originalUserMessage`
- `requestedAt`
- `expiresAt`
- `timeoutBehavior`
- `resumeHint`
- `modelOverride`

### Implemented state transition

The v1 flow is now explicitly:

`accepted -> needs clarification -> awaiting text answer -> resumed | cancelled | expired`

### Implemented timeout behavior

- clarification prompts explicitly state that they expire after 10 minutes
- if the user answers after expiry, the system responds with a visible expiry outcome and clears the pending clarification state
- if the user answers `cancel`, the system returns a visible cancellation outcome and clears the pending clarification state

### Implemented first ambiguous scenario

The current deterministic first slice handles calendar-creation requests that include a date but omit a usable time, for example:

- “put lunch on my calendar tomorrow”

In that case the orchestrator asks for the missing time instead of falling through to a generic no-op response.

## Backlog references now created

- Parent epic: `#405`
- Research issue: `#406`
- Design issue: `#407`
- Implementation issue: `#408`
