# Hybrid identity design inflection — issue-backed research ledger (2026-04-01)

## Purpose

This document duplicates the current GitHub issue context and working process for the hybrid-identity design fork back into the repository, so the reasoning does not live only in issue comments.

This is a **working research ledger**, not a ratified final architecture document.

Related research passes:

- `docs/hybrid-identity-research-pass-1-2026-04-01.md` — first capability-matrix pass across Teams chat affordances, presence, meetings, mail, calendar, and file access.

Backlog linkage now established to the virtual-company / virtual-employee issue surface:

- `#237` — Autonomous Virtual Company Self-Organization & Revenue Pipeline
- `#101` — Virtual Employees & Nested Orchestrators
- `#102` — Virtual employee factory - spawn nested instances

Until the linked research issue is completed, treat this file as:

- a repository-local evidence trail,
- a checkpoint of what was verified on 2026-04-01,
- and a handoff artifact for the next research/design tranche.

## Linked GitHub issues

- Parent: `#443` — `Design inflection: bot vs user identity for Teams AI copilots`
- Child: `#447` — `[RESEARCH] Hybrid identity for HelkinSwarm: bot bootstrap + delegated OBO + digital-worker identity track`

Operational status as of this write-up:

- `#447` was created as a formal child of `#443`.
- `#443` was updated with a progress comment explaining why the first child is research-first.
- `#443` has **not** yet been re-cast as an `[EPIC]`.

That deferral is intentional: the repo should earn the epic split with evidence, not with backlog theater.

## Why this design fork exists

The trigger was not abstract platform chatter. It was a combination of:

1. real-world bot-behavior evidence from the live Teams bot account,
2. existing HelkinSwarm runtime architecture,
3. and Microsoft platform constraints around delegated vs app-only vs user-like identity.

### Bot-ceiling evidence already recorded in `#443`

The issue thread now contains screenshot-backed evidence that the current bot identity hits practical Teams UX limits.

Two concrete examples were called out in the parent issue comments:

- the high-five path degrading to literal shortcode text instead of a native Teams-style effect,
- the `RobotLove.gif` path degrading to a static preview plus a file-consent handoff, rather than behaving like a true human-style inline animated post.

The architectural consequence is straightforward:

> a Teams bot identity is not the same thing as a human-style Microsoft 365 participant.

That matters directly for future HelkinSwarm goals such as:

- richer conversational UX,
- reactions / edits / deletes / human-like affordances,
- meeting participation and roster presence,
- persistent AI-coworker or virtual-employee personas.

## Verified current HelkinSwarm state

### What is wired today

The current production/runtime architecture is already built around delegated user identity via OBO.

#### 1. Teams token exchange bootstrap is wired in the bot runtime

In `src/bot/HelkinSwarmBot.ts`, `handleTeamsSigninTokenExchange()`:

- reads the incoming Teams token exchange payload,
- calls `bootstrapOboSession(...)`,
- and then verifies token retrieval through the current Graph token path.

This is a real runtime code path, not an aspirational comment.

#### 2. Teams tab bootstrap is wired in the Functions runtime

In `src/functions/tabBootstrapObo.ts`, the HTTP route `tab/bootstrap-obo`:

- validates the incoming Teams bearer token,
- calls `bootstrapOboSession(...)`,
- and returns a `bootstrapped` response containing correlation and scope data.

#### 3. Delegated Graph token minting is wired in the auth layer

In `src/auth/oboTokenProvider.ts`, `acquireTokenOnBehalfOf()`:

- uses MSAL confidential-client OBO,
- exchanges the Teams assertion for delegated Microsoft Graph scopes,
- and exposes both direct exchange and silent cached-token acquisition.

The file header is explicit about the intended runtime model:

- user sends a Teams message,
- bot receives Teams SSO,
- OBO exchange yields user-context Graph tokens,
- tokens are cached through the MSAL/Cosmos layer.

#### 4. The living spec already assumes delegated identity

`docs/11-Authentication-Identity.md` already documents:

- OBO delegated tokens as a core identity type,
- Teams token exchange and tab bootstrap as OBO seeds,
- and the current split between true OBO bootstrap vs legacy `/link` magic-code flows.

So this issue is **not** about discovering delegated identity from scratch.

### What is **not** wired today

This is the part that matters for the new design fork.

> I do not see a production runtime path for a licensed mailbox-backed worker identity or agent-user identity anywhere in `src/` today.

What was verified:

- a search over `src/**` for `agent user|agentic user|licensed user|licensed account|user_fic` returned no matches,
- which means there is no obvious production runtime implementation of an Entra Agent ID agent-user flow or a classic licensed-user impersonation path in the core application code.

The only non-OBO interactive auth path that surfaced in code review was local-only test harness behavior:

- `src/mcp/teamsTestHarness.ts` contains Microsoft Graph **device code flow** for the VS Code Teams Test Harness.

That is useful for development and E2E debugging, but it is **not** the production runtime architecture.

## Microsoft platform evidence collected on 2026-04-01

The following first-party documentation was pulled and reviewed during the issue decomposition work.

### Identity fundamentals

Source:

- `https://learn.microsoft.com/entra/identity-platform/permissions-consent-overview`

Key constraints:

- **delegated** permissions act on behalf of a signed-in user,
- **application** permissions act without a user,
- delegated scope is bounded by both app consent and the user’s own effective access,
- application permissions typically require admin consent and can be much broader.

This matters because “bot vs user identity” is not one binary switch. There are at least three materially different permission contexts:

1. bot/app identity,
2. delegated user identity,
3. user-like persistent worker identity.

### OBO constraints

Source:

- `https://learn.microsoft.com/entra/identity-platform/v2-oauth2-on-behalf-of-flow`

Key constraints:

- OBO passes **user** identity and permissions through the chain,
- OBO uses delegated scopes, not app roles,
- OBO does **not** turn app-only tokens into a user-context flow,
- app-only tokens must use client credentials instead,
- and conditional-access challenges can still surface through the chain.

This confirms the HelkinSwarm runtime’s current direction is legitimate for signed-in user-context work, but it also confirms that OBO alone is not a substitute for a true persistent user-like identity.

### Teams chat send constraints

Source:

- `https://learn.microsoft.com/graph/api/chat-post-messages?view=graph-rest-1.0`

Key constraints:

- least-privileged delegated permission for sending a chat message is `ChatMessage.Send`,
- application permission support is effectively `Teamwork.Migrate.All`,
- and that application path is described in migration-oriented terms rather than normal live human-style chat behavior.

That is one of the strongest reasons not to casually assume “app-only will cover the same surface as a user.”

### Interactive-agent guidance

Source:

- `https://learn.microsoft.com/entra/agent-id/identity-platform/interactive-agent-authentication-authorization-flow`

Key constraints:

- Microsoft now explicitly documents **interactive agents** using OBO,
- but it also explicitly points digital-worker scenarios to **Agent users** and the separate **agent user OAuth flow**.

That split is important. Microsoft’s own direction is no longer “just use delegated forever.”

### Granting agents access to Microsoft 365 resources

Source:

- `https://learn.microsoft.com/entra/agent-id/identity-professional/grant-agent-access-microsoft-365`

Key constraints:

- delegated permissions are for interactive agent-on-behalf-of scenarios,
- application permissions are for autonomous agent operation,
- additional governance models such as access packages, Exchange RBAC, and Teams RSC are in scope.

That broadens the research surface well beyond simple Graph scopes.

### Agent users / digital workers

Sources:

- `https://learn.microsoft.com/entra/agent-id/identity-platform/agent-users`
- `https://learn.microsoft.com/entra/agent-id/identity-platform/agent-user-oauth-flow`

Key constraints:

- agent users are designed for cases where an agent must act as a user,
- the issued tokens carry `idtyp=user`,
- the identity is linked 1:1 to a parent agent identity,
- the agent user can be licensed and can receive Microsoft 365 resources such as mailbox and OneDrive,
- the credential model is restricted — no normal passwords or passkeys,
- and Microsoft recommends managed identity / federated identity credentials rather than client secrets.

This is the clearest first-party signal that a modern “digital worker” track exists, but also that it is not the same thing as the older “make a fake licensed user and stuff refresh tokens in a vault” pattern.

### Agent 365 / Frontier direction

Sources:

- `https://learn.microsoft.com/microsoft-agent-365/developer/identity`
- `https://learn.microsoft.com/microsoft-agent-365/developer/agent-365-sdk`

Key constraints and opportunities:

- Microsoft is positioning mailbox-backed, user-like agent identities as a first-class path,
- agents can have their own mailbox/user resources,
- notifications and collaboration patterns across Teams/Outlook/Word are explicitly in scope,
- but the whole stack is still wrapped in **Frontier / preview** caveats.

That means this is promising, but it is not automatically the short-term answer for HelkinSwarm.

## Public code/reference sweep captured during the issue split

The GitHub reference sweep pulled concrete implementation breadcrumbs for user-context patterns.

### Teams token-exchange / SSO samples

Repo:

- `https://github.com/OfficeDev/Microsoft-Teams-Samples`

Relevant paths:

- `samples/TeamsJS/app-sso/nodejs/server/models/ssoOauthHelpler.js`
- `samples/graph-file-fetch/nodejs/ssoOauthHelper.js`

Why these matter:

- both demonstrate `signin/tokenExchange` handling,
- both show the need to deduplicate token-exchange requests across Teams clients,
- and they reinforce that Teams SSO/OBO is a normal, supported pattern for user-context operations.

### Graph mail / calendar / OneDrive client usage sample

Repo:

- `https://github.com/microsoftgraph/msgraph-sdk-javascript`

Relevant path:

- `samples/javascript/SampleRequests.js`

Why it mattered in this tranche:

- it contains sample calls for `/me`,
- `sendMail`,
- `/me/events`,
- and OneDrive file operations such as `/me/drive/items/.../content` and `/me/drive/root/.../content`.

This is not a HelkinSwarm implementation recipe by itself, but it is a practical user-context API reference covering the workloads we care about.

## Working process executed on 2026-04-01

The following sequence was executed before cutting the child research issue.

1. Pulled parent issue `#443` directly from GitHub.
2. Read the current repo/runtime auth files to verify what is already implemented.
3. Ran a Microsoft Docs search/fetch sweep for:
   - delegated vs app-only,
   - OBO,
   - Teams chat send constraints,
   - Entra Agent ID,
   - agent users,
   - Agent 365 SDK direction.
4. Ran public GitHub repository/code search for:
   - Teams token-exchange samples,
   - Graph file/mail/user-context examples.
5. Verified the current gap in the HelkinSwarm runtime:
   - delegated OBO exists,
   - persistent user-like worker identity does not appear to be wired in `src/` today.
6. Created `#447` as the first child issue.
7. Applied labels:
   - `architecture`
   - `auth`
   - `teams`
   - `virtual-employees`
8. Linked `#447` as a formal sub-issue under `#443`.
9. Added a parent issue comment explaining the research-first decomposition and the deliberate deferral of epic recasting.

## Current working position

This is **not** the final architecture choice yet, but the current evidence supports the following framing:

### Near-certain keepers

- Keep the existing **Bot ID** for installation, bootstrap, routing, and notification-friendly bot semantics.
- Keep **delegated OBO** for signed-in user-context operations.

### Must-research next, not assume

- Whether HelkinSwarm also needs a third identity tier for persistent digital-worker behavior.
- Whether that tier should be:
  - a classic licensed Microsoft 365 user account,
  - an Entra Agent ID agent user,
  - or a staged path from one to the other.

### Explicitly untrusted assumptions

These assumptions should remain untrusted until `#447` closes:

- that ROPC is an acceptable production path,
- that refresh-token hoarding around a fake licensed user is the preferred long-term model,
- that user-like Teams affordances automatically become available merely because a user account exists,
- that Agent ID / agent-user preview dependencies fit HelkinSwarm’s timeline without material risk.

## Questions the research issue must answer

`#447` should resolve at least the following:

- Which Teams/Microsoft 365 behaviors truly require a user identity?
- Which are satisfied by delegated OBO alone?
- Which require a persistent user-like worker identity?
- What is the cleanest split between:
  - bot identity,
  - delegated user identity,
  - persistent digital-worker identity?
- What are the real operational costs:
  - licensing,
  - mailbox and OneDrive provisioning latency,
  - conditional access,
  - audit/governance,
  - preview risk,
  - teardown/lifecycle?
- What changes, if any, are required in the stamp-level orchestrator/auth model before HelkinSwarm can safely carry a third identity tier?

## Why `#443` was not turned into an epic yet

The parent issue probably *will* become an epic later.

It was not relabeled immediately because the correct child breakdown depends on the research result.

If we had created design, planning, and execution children before finishing the research pass, we would have risked locking the repo into one of these bad patterns:

- assuming the answer is a classic licensed user account,
- assuming Agent ID preview is automatically viable,
- or treating delegated OBO as interchangeable with a persistent digital worker.

That would have been architecture by enthusiasm instead of architecture by evidence.

## Suggested next repo-local follow-up after `#447`

Once the research issue lands, this document should be followed by a more stable design note or addendum covering:

- the selected target identity model,
- the three-tier identity split if adopted,
- auth/token/consent/lifecycle implications,
- and the migration path from current runtime to target runtime.

At that point, `#443` can be safely re-cast as an `[EPIC]` and the execution backlog can be split without guessing.

## Source ledger

### Repository files read during this tranche

- `src/bot/HelkinSwarmBot.ts`
- `src/functions/tabBootstrapObo.ts`
- `src/auth/oboTokenProvider.ts`
- `src/mcp/teamsTestHarness.ts`
- `docs/11-Authentication-Identity.md`
- `docs/0j-Virtual-Employees-and-Nested-Orchestrators.md`
- `docs/IDENTITY-REGISTRY.md`

### First-party Microsoft docs reviewed

- `https://learn.microsoft.com/entra/identity-platform/permissions-consent-overview`
- `https://learn.microsoft.com/entra/identity-platform/v2-oauth2-on-behalf-of-flow`
- `https://learn.microsoft.com/graph/api/chat-post-messages?view=graph-rest-1.0`
- `https://learn.microsoft.com/entra/agent-id/identity-platform/interactive-agent-authentication-authorization-flow`
- `https://learn.microsoft.com/entra/agent-id/identity-professional/grant-agent-access-microsoft-365`
- `https://learn.microsoft.com/entra/agent-id/identity-platform/agent-users`
- `https://learn.microsoft.com/entra/agent-id/identity-platform/agent-user-oauth-flow`
- `https://learn.microsoft.com/microsoft-agent-365/developer/identity`
- `https://learn.microsoft.com/microsoft-agent-365/developer/agent-365-sdk`

### Public GitHub references reviewed

- `https://github.com/OfficeDev/Microsoft-Teams-Samples`
- `https://github.com/microsoftgraph/msgraph-sdk-javascript`
