# Orchestrator Clarification Loop Research Notes — 2026-03-30

## Purpose

Capture the first-pass platform research for the orchestrator clarification loop concept.

This note is not the final architecture. It is a grounded research summary intended to help issue `#406` converge on a recommended implementation path for HelkinSwarm.

## Related backlog

- `#405` — epic: orchestrator clarification loop for ambiguous or underspecified requests
- `#406` — research: Teams UX options for orchestrator clarification loops
- `#407` — architecture: clarification-loop state model and core capability contract
- `#408` — feature: implement first usable orchestrator clarification loop in Teams

## HelkinSwarm repo-grounded starting point

HelkinSwarm already has several ingredients needed for this feature:

- `src/bot/HelkinSwarmBot.ts`
  - stores pending ack IDs
  - updates activities in place
  - handles `onAdaptiveCardInvoke(...)`
- `src/bot/conversationStore.ts`
  - durable pending-ack ownership
- `src/bot/confirmationCards.ts`
  - existing `Action.Execute` card round-trips
- `#267`
  - correlated placeholder / spinner lifecycle work
- `#373`
  - every accepted query must resolve its placeholder with a terminal outcome

This means the clarification-loop concept is not starting from zero. The main missing pieces are the orchestrator contract and the user-facing refinement flow.

## Microsoft guidance reviewed

### 1. Bot message updates

Microsoft Teams documentation confirms bots can update previously sent messages/cards in place using message update APIs / SDK methods such as `updateActivity`.

Why it matters:

- HelkinSwarm already uses an ack → replace lifecycle
- clarification can therefore stay anchored to the original placeholder rather than creating disconnected breadcrumb messages

### 2. Universal Actions / `Action.Execute`

Microsoft Learn guidance shows that Teams bots can:

- use `Action.Execute`
- handle `adaptiveCard/action` invoke requests
- return updated cards immediately in response

Why it matters:

- this is a strong fit for structured clarifications
- it keeps the interaction inside the same message slot
- it avoids forcing the user into a separate tab or flow for small ambiguities

### 3. Sequential workflows

Microsoft documents explicit support for sequential Adaptive Card workflows updated on user action.

Why it matters:

- HelkinSwarm could ask a short sequence of targeted questions without launching a full dialog
- this is especially attractive when the clarification needs 2–3 structured steps, not a full form

### 4. Dialogs / task modules

Microsoft guidance positions dialogs as a strong UX for richer or more complex data-entry tasks.

Why it matters:

- dialogs remain a valid higher-complexity option
- they are likely better reserved for heavier clarification cases, not the default for quick follow-up questions

## Official sample direction

The GitHub code search pass found relevant official ecosystems / sample directions including:

- `OfficeDev/Microsoft-Teams-Samples`
- `OfficeDev/Microsoft-Teams-Adaptive-Card-Samples`
- samples related to:
  - task-module / dialog fetch + submit flows
  - sequential Adaptive Card workflows
  - message update patterns
  - card action handlers

This is enough to conclude that the platform primitives HelkinSwarm needs are established and sample-backed, even if the exact final HelkinSwarm architecture will differ.

## Refined implementation recommendation

### Recommended default stack

#### Tier 1 — plain text clarification

Use when:
- only one short free-text answer is needed
- structured choices are unnecessary
- the fastest path is simply to ask one concise question

#### Tier 2 — in-place Adaptive Card clarification (recommended default)

Use when:
- the ambiguity can be represented as a choice or small form
- structured answers reduce routing ambiguity
- the clarification should remain attached to the placeholder message

Examples:
- choose between two likely tools/domains
- select one of several targets
- provide one missing required field
- confirm one routing assumption before action proceeds

#### Tier 3 — dialog / task-module clarification

Use when:
- several fields are required
- a small wizard is easier than chat-based interaction
- the clarification becomes a real mini-form rather than a quick refinement

## Current best recommendation

For the first implementation slice, the best target appears to be:

- plain-text fallback always available
- Adaptive Card clarification as the primary structured mode
- dialog/task-module support deferred unless the research/design phase proves it is required immediately

## Risks / notes

- message-update compatibility and card-version compatibility need to be treated carefully
- `Action.Execute` / universal-action features require version/support considerations in Teams clients
- the clarification flow must not break the “every placeholder resolves” rule
- the system must resume the original task instead of forcing the user to start over after clarifying

## Open design questions for `#407`

- Should the clarification capability be a literal core tool, or an orchestration primitive exposed tool-like to the planner?
- What structured answer modes should be supported in v1?
- How should suspended-turn state be persisted?
- How should timeout / abandonment resolve visibly?
- How much free-form LLM-generated questioning is acceptable versus constrained templates/contracts?

## Bottom line

The platform research strongly supports this direction.

The best current HelkinSwarm fit looks like:

- **text fallback** for trivial cases
- **in-place Adaptive Card clarification** as the main happy path
- **dialogs** only for heavier refinement scenarios
