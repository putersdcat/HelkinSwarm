# Findings and Evidence — SitRep 2026-04-02

## Finding 1 — Skill operational state is under-modelled and misreported

### Summary

The current runtime/UI semantics do not cleanly distinguish between:

- manifest loaded
- skill installed
- user linked
- tenant/operator prerequisites satisfied
- fully operational

That gap directly explains the confusing `graphenterprise` activation output and also matches the known `web` skill anti-pattern.

### Repo evidence

#### A. The catalog reports every loaded manifest as installed

File: `src/capabilities/capabilityLoader.ts`

`getSkillCatalog()` emits:
- `installed: true`
- for every manifest present in `manifestRegistry`

There is no separate verified operational state in the catalog entry shape.

#### B. The install-readiness API returns `status: 'ready'` even when activation steps still exist

File: `src/capabilities/capabilityLoader.ts`

`inspectSkillInstall(skillId)`:
- only returns `blocked` when dependencies are missing
- otherwise always returns `status: 'ready'`
- even if it adds steps for:
  - `automatic-agentic`
  - external accounts
  - required permissions
  - soft onboarding

It also emits this mixed message pattern:
- `status: 'ready'`
- message: `Skill '<id>' is installed. Complete the steps listed to activate it.`

That is internally contradictory from a product-state perspective.

#### C. The current Skills UI visibly collapses loaded and operational state

File: `tabs/app.js`

`renderManageSkillCard(s)` renders:
- `<span class="badge badge-ok">Loaded</span>`
- regardless of whether the skill still has unmet external requirements

`renderSkillCard(s, showMetadata)` renders:
- `Installed`
- plus metadata such as onboarding method, permissions, and accounts
- but no explicit operational/readiness state derived from real checks

#### D. `graphenterprise` is a concrete example of the semantic mismatch

File: `skills/graphenterprise/manifest.json`

It declares:
- `onboardingMethod: "automatic-agentic"`
- many `requiredPermissions`
- `externalAccountsNeeded: ["Microsoft Entra work or school account in the target tenant"]`
- remote `mcpServer` at `https://mcp.svc.cloud.microsoft/enterprise`

That means the manifest itself encodes a real tenant/bootstrap dependency surface while the current readiness path still reports `ready` once dependencies are present.

#### E. `web` remains the documented anti-pattern and still reproduces the same rollout smell

Files:
- `skills/web/manifest.json`
- `skills/web/handlers.ts`
- `docs/05-Capabilities-Framework.md`

Evidence:
- `skills/web/manifest.json` declares `onboardingMethod: "automatic-agentic"`
- the same manifest declares `externalAccountsNeeded: ["Brave Search API key"]`
- `skills/web/handlers.ts` throws:
  - `Web search not configured — BRAVE_SEARCH_API_KEY not set...`

The docs already call this exact pattern out as unacceptable rollout behavior.

### Doc/backlog drift evidence

File: `docs/05-Capabilities-Framework.md`

This document already defines:
- `operator/backend-config-required`
- mandatory preflight readiness checks
- the rule that such skills must **not** be exposed as ready for normal use until prerequisites and fallback behavior exist

Yet the current runtime skill catalog/readiness logic does not model that richer operational state.

Related issues:
- `#371` — documented the rollout/readiness standard
- `#376` — management UX gap in Skills Library
- `#465` — Graph Enterprise delivery slice explicitly acknowledged tenant/bootstrap concerns
- `#476` — post-provision readiness checks in M365 admin workflows

### Assessment

This is not just a wording problem. It is a **product-state model gap**:

- the code understands manifest presence
- the code understands dependencies
- the code lists external requirements
- but the code does not yet expose a truthful end-user state model for operational readiness

### Likely corrective direction

Introduce an explicit readiness/operational model that can differentiate at least:

- `loaded`
- `installed`
- `action-required`
- `blocked`
- `operational`
- possibly `operator-setup-required`

That state must drive:
- Skills Library badges
- install/readiness responses
- orchestrator exposure/selection decisions for non-chat-recoverable skills

---

## Finding 2 — Graph Enterprise appears to be a real integration path, but not proven universally tenant-ready

### Summary

The current evidence does **not** support saying Graph Enterprise is fake. The connector/auth path is real. The problem is that runtime/state reporting currently overstates readiness relative to tenant/bootstrap reality.

### Repo evidence

#### A. The delivery doc is already honest about the tenant-bootstrap gap

File: `docs/Delivery/microsoft-graph-enterprise-mcp-skill-2026-04-02.md`

The doc explicitly says the slice does **not** prove the target tenant has already granted the required Enterprise MCP scopes.

#### B. The MCP connector supports per-call scoped bearer-header injection

File: `src/mcp/mcpConnector.ts`

`resolveHeaderTemplates()` and `buildRuntimeTemplateValues()` support:
- `${scopedToken}`
- `${userId}`
- `${correlationId}`

This is real runtime wiring, not placeholder documentation.

#### C. Tool dispatch injects scoped tokens into tool calls

File: `src/orchestrator/toolDispatchActivity.ts`

Low/medium-risk tool dispatch:
- adds `userId` and `correlationId`
- maps privilege class to scoped token scope
- attempts token minting
- injects `_scopedToken`, `_scopedTokenScope`, `_scopedTokenMethod`

#### D. Graph Enterprise delegated-scope behavior is tested

Files:
- `tests/auth/scopedTokenMinter.test.ts`
- `tests/mcp/mcpConnectorStreamableHttp.test.ts`

Verified test evidence:
- token minting requests Enterprise MCP delegated scopes for `graphenterprise`
- streamable-http connector tests verify `Authorization: Bearer ${scopedToken}` template injection

### Assessment

The best current interpretation is:

- **connector path exists**
- **auth integration path exists**
- **tenant readiness may not exist in every environment**
- **the UI does not tell the truth clearly enough about that distinction**

---

## Finding 3 — Quoted/follow-up continuity is still architecturally brittle

### Summary

Quoted reply context is now threaded structurally through the bot → overseer → prompt path, but I do not yet see it elevated into a first-class routing/continuity mechanism beyond prompt injection.

That means the system likely still relies too much on LLM interpretation for follow-up grounding in general-purpose conversational flows.

### Repo evidence

#### A. Quoted reply extraction is real and fairly robust

File: `src/bot/HelkinSwarmBot.ts`

`extractQuotedReply(context)` resolves quoted text from:
1. sent-message cache
2. Teams quote entities
3. `channelData.quotedMessageContent`
4. messageReference attachments
5. HTML blockquote fallback

This is a real feature, not a stub.

#### B. Quoted context is passed into orchestration state

Files:
- `src/bot/HelkinSwarmBot.ts`
- `src/orchestrator/overseer.ts`
- `src/orchestrator/sessionOrchestrator.ts`

The event/session input shape includes `quotedContext`.

#### C. But the verified downstream use is prompt injection, not deterministic orchestration logic

File: `src/orchestrator/buildPromptActivity.ts`

Quoted context is injected as:
- `[Replying to a previous message ...]`
- followed by the quoted text

I do **not** currently see quoted context used in deterministic skill-routing or follow-up-state logic in the orchestrator files read during this pass.

### Backlog history showing this area is already fragile

Relevant issues:
- `#278` — structured quoted-reply threading
- `#405` — clarification-loop epic
- `#408` — first usable clarification loop
- `#428` — resumed clarification routing bug
- `#431` — quoted clarification replies stranded the ack instead of resolving cleanly
- `#329` — raw sub-session/orchestration output leaked into user chat

This history strongly suggests continuity and user-facing orchestration polish have been recurrent problem areas rather than a one-off.

### Assessment

Current likely state:
- quoted context is **available** to the LLM
- quoted context is **not yet strong enough as orchestration state** for trustworthy follow-up handling across all conversational cases
- the end-user can therefore still encounter responses that feel like internal orchestration artifacts rather than clean product behavior

---

## Finding 4 — The runtime has likely outgrown some of its current honesty surfaces

### Summary

The repo has accumulated real features quickly, but some UX/status surfaces still report simplified states that no longer reflect the complexity of the actual architecture.

Examples:
- `loaded` badge where operational status is unresolved
- `ready` readiness state while activation steps remain
- discovery-style replies that surface internal selection context in a way that confuses the user

### Assessment

This feels less like a single regression and more like **maturity debt**:

- architecture got richer
- delivery continued fast
- some truth-telling surfaces did not evolve at the same pace

That is exactly the kind of drift a SitRep should catch.
