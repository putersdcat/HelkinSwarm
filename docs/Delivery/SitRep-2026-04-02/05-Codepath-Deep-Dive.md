# Codepath Deep Dive — Second Pass

## Purpose

This pass re-checks the most relevant runtime codepaths after the first-pass findings, with an emphasis on narrowing hypotheses rather than broadening them.

## 1. Skill readiness / operational-state codepath

### Files read
- `src/capabilities/capabilityLoader.ts`
- `skills/graphenterprise/manifest.json`
- `skills/web/manifest.json`
- `skills/web/handlers.ts`
- `tabs/app.js`
- `docs/05-Capabilities-Framework.md`
- `docs/skills-system-enhancement-2026-03-24v2.md`

### What the code actually does today

#### Catalog layer
`getSkillCatalog()` in `src/capabilities/capabilityLoader.ts`:
- exposes loaded manifests as catalog entries
- sets `installed: true` for every manifest in the registry
- exposes metadata such as onboarding method, permissions, and external accounts
- does **not** expose a verified operational state

#### Install-readiness layer
`inspectSkillInstall(skillId)`:
- blocks only on missing dependencies
- otherwise returns `status: 'ready'`
- still appends steps for:
  - link/oauth
  - automatic onboarding notes
  - external accounts
  - required permissions
  - soft onboarding

This means the current API is really closer to:
- “manifest present and dependency-complete”
than to:
- “fully operational right now”

#### UI layer
`tabs/app.js`:
- surfaces `Installed` and `Loaded` badges
- can show readiness metadata and activation steps
- does not yet display a richer operational-state taxonomy

### Why this is deeper than a copy bug
The runtime is missing a **state concept**, not just the perfect wording.

The manifest schema has:
- `onboardingMethod`
- `requiredPermissions`
- `externalAccountsNeeded`

But there is no first-class runtime concept for:
- preflight passed
- operator setup missing
- tenant consent missing
- functional probe passed
- operationally usable

## 2. Graph Enterprise codepath

### Files/tests read
- `skills/graphenterprise/manifest.json`
- `src/mcp/mcpConnector.ts`
- `src/orchestrator/toolDispatchActivity.ts`
- `src/auth/tokenScopeMapping.ts`
- `tests/auth/scopedTokenMinter.test.ts`
- `tests/mcp/mcpConnectorStreamableHttp.test.ts`

### Verified reality

#### Real integration pieces exist
- the skill manifest exists with a streamable HTTP MCP definition
- `Authorization: Bearer ${scopedToken}` template injection is supported
- tool dispatch mints and passes scoped tokens
- tests verify Enterprise MCP delegated scopes for `graphenterprise`
- tests verify streamable HTTP header interpolation for the Enterprise MCP path

### Practical interpretation
The repo-side Graph Enterprise slice is real.

But the runtime has no built-in distinction between:
- “repo integration exists”
- “tenant bootstrap completed”
- “delegated consent granted”
- “live enterprise query succeeded in this environment”

That missing distinction is why a skill can feel “shipped” in engineering terms while still feeling misleading in end-user terms.

## 3. Follow-up / discovery / continuity codepath

### Files read
- `src/orchestrator/sessionOrchestrator.ts`
- `src/orchestrator/buildPromptActivity.ts`
- `src/orchestrator/discoveryToolInjection.ts`
- `src/bot/HelkinSwarmBot.ts`

### Important refinement versus the first pass
The second pass found that some routing logic is more modern than the initial suspicion suggested.

#### Good sign: `effectiveTaskMessage` is already used in key later routing steps
In `src/orchestrator/sessionOrchestrator.ts`, later stages now use `effectiveTaskMessage` for:
- read-only discovery response shaping
- deterministic exact tool response handling
- forced follow-up tool choice
- discovery dead-end response generation

That means the older `#428` class of bug was not simply left untouched everywhere.

#### Quoted context path is still mostly prompt-level
`src/bot/HelkinSwarmBot.ts` extracts structured `quotedContext`.
`src/orchestrator/buildPromptActivity.ts` injects it into the prompt.

But in the code read during this pass, quoted context still appears primarily as **prompt context**, not as a strong deterministic routing primitive.

So the current limitation is subtler than “quoted replies unwired”:
- quote context exists
- some clarification paths are fixed
- but generic follow-up grounding still leans heavily on model behavior

## 4. User-facing orchestrator-style prose is explicitly generated in code

### File read
- `src/orchestrator/discoveryToolInjection.ts`

### Current strings that matter
The code deliberately emits end-user-facing text such as:
- `I searched the installed skills for a matching action, but I did not reach an executable tool from discovery...`
- `I stayed in discovery-only mode...`
- `No non-discovery tools were executed.`

### Why this matters
This is not merely a user perception problem.
The current product really does have an output mode where orchestration/discovery-state narration is surfaced directly to the chat participant.

That may be acceptable for debugging or controlled transparency in some contexts, but it also explains why the experience can feel more like internal orchestration output than a polished assistant answer.

## 5. Deeper hypothesis after second pass

The strongest code-backed hypothesis now is:

### Primary weakness
HelkinSwarm currently lacks a robust, shared concept of **execution proof / operational proof** across both:
- skills surfaces
- follow-up orchestration behavior

### Manifestation A — Skills Library / readiness
Without an operational-state model, the UI can only show presence/metadata plus generic steps.

### Manifestation B — Follow-up verification turns
Without a deterministic “demonstrate the selected skill now” follow-up pathway, the system can drift back into:
- discovery prose
- health/status prose
- routing narration
instead of performing or honestly declining the concrete proof request.

## 6. What this changes from the first pass

### Stronger now
- the case for `#484`
- the case for `#485`
- the case that the product needs a truthfulness/continuity correction wave

### Weaker now
- any blanket claim that recent routing/clarification work was broadly fake or unwired
- any blanket claim that the Graph Enterprise integration is merely a paper feature

## 7. Codepath takeaway

The app looks less like “totally off course” and more like this:

- core architecture: still broadly on course
- many narrow delivery slices: real
- product-edge semantics and execution-proof behavior: lagging behind the architecture

That lag is enough to create a meaningful trust regression even when plenty of real engineering work has landed under the hood.