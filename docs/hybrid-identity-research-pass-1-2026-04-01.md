# Hybrid identity research — pass 1 (2026-04-01)

## Purpose

This is the first substantive research pass for GitHub issue `#447`.

The goal of this pass is to answer one narrower question before the larger architectural recommendation is made:

> Which collaboration and Microsoft 365 capabilities are already covered by delegated user identity, which are available app-only, and which still appear to justify a persistent digital-worker identity?

This document is intentionally evidence-first and provisional.

## Scope of this pass

This pass focused on:

- Teams chat message send / edit / delete / reaction,
- Teams presence,
- Teams online meeting creation,
- Outlook mail send and calendar access,
- SharePoint / OneDrive file access patterns,
- and the current state of public Microsoft Agent 365 SDK / sample repositories.

## High-confidence findings

### 1. Delegated identity already covers more Teams “human-style” actions than a bot identity does

The first important result is that delegated user identity is stronger than the initial design-fork narrative might imply.

Based on Microsoft Graph docs reviewed in this pass:

- sending chat messages supports delegated `ChatMessage.Send`,
- updating chat messages supports delegated `Chat.ReadWrite`,
- soft-deleting chat messages supports delegated `Chat.ReadWrite`,
- setting reactions supports delegated `Chat.ReadWrite` or `ChatMessage.Send` depending on route,
- and those message-object actions are **not** broadly mirrored by application permissions.

That means a pure bot identity is not the ceiling, but a pure app-only service principal is not the answer either.

For reactive, signed-in, user-context Teams behavior, delegated OBO remains a serious and likely durable part of the architecture.

### 2. App-only is useful, but not as a full substitute for human-like Teams chat behavior

This pass found an important asymmetry.

Some capabilities **do** support app-only patterns:

- setting presence,
- creating or getting online meetings,
- sending mail,
- calendar access,
- and SharePoint / OneDrive access.

But several Teams chat lifecycle affordances remain delegated-only for real message objects:

- reaction setting,
- soft delete,
- undo soft delete,
- and normal message editing.

Application permissions for message updates are mostly about **policyViolation / DLP** paths, not general human-like editing.

So if the future target is “autonomous digital coworker that behaves like a real teammate inside Teams chat,” app-only alone does not appear sufficient.

### 3. The value proposition of a digital-worker identity is narrowing into sharper focus

This pass suggests the third identity tier is probably **not** justified merely because HelkinSwarm needs access to Microsoft 365 workloads.

Delegated plus app-only together already cover a lot:

- reactive user-context collaboration,
- autonomous mail/calendar/file workflows,
- governed background operations,
- some meeting and presence scenarios.

The third identity tier becomes compelling when the requirement becomes one of **persistent personhood**, for example:

- autonomous human-like chat actions in Teams,
- mailbox-backed durable presence/persona,
- OneDrive/mailbox ownership as a first-class participant,
- independent roster / directory existence,
- and long-running digital-worker semantics rather than user-on-behalf-of semantics.

### 4. Agent 365 / agent-user public ecosystem is real, but the public examples are still early and skew SDK-first

This pass verified that Microsoft now has public repositories for:

- `microsoft/Agent365-nodejs`
- `microsoft/Agent365-Samples`

The public repo story is no longer imaginary.

However, the quick sweep in this pass found mostly:

- SDK packages,
- tooling/runtime/observability/notifications structure,
- sample-agent scaffolding across languages,
- and platform integration examples.

I do **not** yet see abundant public end-to-end examples of a production-ready “licensed human-style agent user that fully behaves like a durable coworker across Teams/Outlook/OneDrive.”

That does not mean the pattern is impossible.

It means the public example base is still maturing, and we should not pretend there is a giant stable gallery of proven implementations to cargo-cult from.

## Capability matrix — first-pass view

| Capability | Delegated user identity | Application identity | First-pass implication |
| --- | --- | --- | --- |
| Send Teams chat message | **Yes** — `ChatMessage.Send` | **Limited** — migration-oriented `Teamwork.Migrate.All` path, not normal human-style send | Reactive user-context send fits delegated OBO much better than app-only |
| Edit Teams chat message | **Yes** — delegated `Chat.ReadWrite` supports normal message updates | **Limited** — app-only is mainly `policyViolation` / DLP territory | Human-style message editing points toward delegated or user-like identity, not plain app-only |
| Delete Teams chat message | **Yes** — `chatMessage: softDelete` delegated `Chat.ReadWrite` | **No** for `chatMessage: softDelete` | Autonomous human-like message lifecycle remains a gap for app-only |
| React to Teams message | **Yes** — delegated reaction APIs | **No** | Reactions are another strong signal that pure app-only is not human-parity |
| Set Teams presence | **Yes** — `Presence.ReadWrite` | **Yes** — `Presence.ReadWrite.All` | Presence alone does not justify a digital-worker identity |
| Create/get online meeting | **Yes** — `OnlineMeetings.ReadWrite` | **Yes** — `OnlineMeetings.ReadWrite.All` with application access policy | App-only can help with background meeting operations, but this is not the same as joining/behaving as a human participant |
| Send Outlook mail | **Yes** — `Mail.Send` | **Yes** — `Mail.Send` application permission with mailbox limiting via application access policy | Mail workflows alone do not force a third identity tier |
| Read/write calendars | **Yes** — `Calendars.ReadWrite` | **Yes** — `Calendars.ReadWrite` application permission with mailbox limiting via application access policy | Background scheduling can likely live without a digital-worker identity in some cases |
| SharePoint / OneDrive file access | **Yes** — delegated intersection with user permissions | **Yes** — application or selected scopes available | File access is not by itself evidence that a worker identity is mandatory |

## Evidence notes by area

### Teams message send

Source:

- `https://learn.microsoft.com/graph/api/chat-post-messages?view=graph-rest-1.0`

Key takeaway:

- delegated least privilege is `ChatMessage.Send`,
- application path is `Teamwork.Migrate.All`,
- and the page explicitly frames that API as not recommended for migration-scale use anyway.

Interpretation:

- for normal live conversational send behavior, delegated is the realistic path,
- app-only is not a clean human-equivalent messaging model.

### Teams message update

Source:

- `https://learn.microsoft.com/graph/api/chatmessage-update?view=graph-rest-1.0`

Key takeaway:

- delegated scenarios can update message properties generally,
- application scenarios can update only the `policyViolation` property.

Interpretation:

- normal human-style message editing is delegated-first,
- app-only update is not a general substitute.

### Teams message delete / undelete

Sources:

- `https://learn.microsoft.com/graph/api/chatmessage-softdelete?view=graph-rest-1.0`
- `https://learn.microsoft.com/graph/api/chatmessage-undosoftdelete?view=graph-rest-1.0`

Key takeaway:

- chat/channel message soft delete is delegated-only,
- undo soft delete is also delegated-only,
- application permissions are not supported for these message-object paths.

Interpretation:

- if HelkinSwarm eventually needs autonomous message cleanup that looks like a teammate acting in Teams chat, pure app-only still falls short.

### Teams message reactions

Source:

- `https://learn.microsoft.com/graph/api/chatmessage-setreaction?view=graph-rest-1.0`

Key takeaway:

- reactions are delegated-only,
- application permissions are not supported.

Interpretation:

- reactions are one of the cleanest examples where human-like Teams affordances remain outside normal app-only parity.

### Presence

Source:

- `https://learn.microsoft.com/graph/api/presence-setpresence?view=graph-rest-1.0`

Key takeaway:

- delegated `Presence.ReadWrite` exists,
- application `Presence.ReadWrite.All` also exists,
- presence sessions are time-bounded and session-based.

Interpretation:

- presence control alone should not be used as the decisive argument for creating a digital-worker identity.

### Online meetings

Sources:

- `https://learn.microsoft.com/graph/api/onlinemeeting-createorget?view=graph-rest-1.0`
- `https://learn.microsoft.com/graph/api/onlinemeeting-delete?view=graph-rest-1.0`

Key takeaway:

- online meetings can be created with delegated permissions,
- they can also be created app-only with `OnlineMeetings.ReadWrite.All` plus an application access policy,
- `createOrGet` explicitly notes the meeting does **not** show on the user’s calendar.

Interpretation:

- app-only can help with some autonomous meeting workflows,
- but “meeting object exists” is not the same as “digital coworker joined and behaved like a full human participant.”

### Mail and calendars

Source excerpts came from Microsoft Graph permissions reference search results.

Key takeaways:

- `Mail.Send` supports both delegated and application permission forms,
- `Calendars.ReadWrite` supports both delegated and application permission forms,
- Microsoft documents application access policy as the control surface for restricting app access to specific mailboxes.

Interpretation:

- autonomous mail and calendar work can be achieved without immediately requiring a dedicated worker identity,
- though ownership, mailbox persona, and long-lived presence may still push the design toward one.

### SharePoint / OneDrive

Source excerpts:

- Graph permissions reference
- Selected permissions overview for OneDrive and SharePoint

Key takeaways:

- both delegated and application patterns exist,
- delegated access is computed as the intersection of app permission and the user’s own effective access,
- selected scopes support finer-grained file/list/site access patterns,
- delegated is explicitly described as preferred when possible.

Interpretation:

- file access does not, by itself, force a worker-identity model.

## Public code / repo observations

### OfficeDev Teams samples remain the most concrete public SSO/OBO breadcrumb set

Useful references confirmed again in this pass:

- `OfficeDev/Microsoft-Teams-Samples/samples/TeamsJS/app-sso/nodejs/server/models/ssoOauthHelpler.js`
- `OfficeDev/Microsoft-Teams-Samples/samples/graph-file-fetch/nodejs/ssoOauthHelper.js`
- multiple additional `TokenExchangeHelper` / `ssoOauthHelpler` implementations across Teams samples.

Interpretation:

- public code examples for Teams SSO/token-exchange are healthy,
- public code examples for true user-like persistent digital workers are far less obvious.

### Official Agent 365 repos are now real and relevant

Confirmed repositories:

- `https://github.com/microsoft/Agent365-nodejs`
- `https://github.com/microsoft/Agent365-Samples`

What the quick pass confirmed:

- the Node.js repo contains public SDK packages for runtime, tooling, observability, and notifications,
- the design docs explicitly reference Teams, Copilot Studio, Webchat, MCP tooling, and agent notifications,
- the samples repo contains sample agents across `.NET`, `Python`, and `Node.js/TypeScript` with E2E coverage.

What this quick pass did **not** yet confirm:

- a rich set of public, end-to-end “licensed human-style agent user” sample implementations demonstrating full collaboration parity across Teams, Outlook, and OneDrive.

This is an important distinction for HelkinSwarm planning.

## Preliminary architecture implications for HelkinSwarm

### Candidate split, first pass

The evidence currently suggests the architecture may want to separate into four conceptual lanes, even if only three are implemented in practice.

#### 1. Bot identity

Best fit for:

- installation,
- bootstrap,
- command surface,
- notifications,
- app presence in Teams as a bot.

#### 2. Delegated user identity (current OBO path)

Best fit for:

- reactive user-context Teams actions,
- personal Outlook / OneDrive / SharePoint access as the signed-in user,
- message send/edit/delete/react operations that need human-style semantics during an interactive session.

#### 3. Governed app-only workload path

Best fit for:

- autonomous or scheduled operations,
- mail/calendar/file workloads where application permissions and access policies are available,
- selected-scope SharePoint/OneDrive access,
- some presence and online-meeting operations.

#### 4. Persistent digital-worker identity (still under investigation)

Potentially justified when HelkinSwarm must become:

- a durable Microsoft 365 participant,
- a mailbox-owning / OneDrive-owning persona,
- an autonomous collaborator inside chat workflows,
- or a long-running virtual employee with user-like directory identity.

## Open questions carried into pass 2

- What is the true gap between “can create/get meeting objects” and “can join and behave as a participant” across bot, delegated, app-only, and agent-user models?
- Which of the screenshot-backed bot UX limitations are platform-hard limits versus merely bot-surface limitations that delegated identity can already bypass?
- What are the exact licensing / provisioning / latency / governance costs of:
  - classic licensed user,
  - Entra Agent ID agent user,
  - and staged hybrid models?
- Does Agent 365 preview status make agent-user adoption a strategic target but not a near-term implementation choice?

## First-pass recommendation status

No final architecture recommendation yet.

But the current evidence does support these interim positions:

- **Keep** bot identity.
- **Keep** delegated OBO.
- **Do not assume** app-only is enough for human-like Teams parity.
- **Do not assume** a digital-worker identity is required for every autonomous M365 workload.
- **Continue researching** whether the third tier is justified specifically by persistent personhood/autonomy requirements rather than by generic Microsoft 365 access.

## Steering note — why this issue stays open

This research should remain open for further exploration.

The current first-pass conclusion is **not** “we do not need agentic personhood.”

The current conclusion is narrower:

- we do not yet have enough evidence to justify a final identity architecture,
- delegated OBO is stronger than a bot-only reading suggests,
- app-only is useful but not human-parity in Teams chat,
- and the third identity tier should be justified by real persistent-personhood requirements rather than assumed up front.

That matters because future HelkinSwarm architecture may still demand a persistent identity for one or both of these roles:

- the top-level stamp orchestrator / main HelkinSwarm organizational agent,
- spawned virtual employees acting as durable members of a virtual company.

If either of those roles must communicate with outside humans as persistent organizational actors, own mailbox/OneDrive resources, or behave as long-lived teammates rather than ephemeral user-delegated assistants, the agent-user / digital-worker question becomes central again.

So the correct posture right now is:

- keep the issue open,
- keep researching,
- and explicitly link the work into the virtual-company and virtual-employee backlog rather than treating it as an isolated Teams-auth curiosity.

## Backlog linkage

This research is now explicitly related to:

- `#237` — `[EPIC] Autonomous Virtual Company Self-Organization & Revenue Pipeline`
- `#101` — `[EPIC] Virtual Employees & Nested Orchestrators (Post-MVP)`
- `#102` — `Virtual employee factory - spawn nested instances`

Why these links matter:

- `#237` frames the long-term goal of a practical, self-organizing virtual company operating in the real world.
- `#101` already assumes virtual employees have their own identity, skill memory, durable hooks, and conversation thread.
- `#102` explicitly says virtual employees will be spawned with a **unique Entra identity**.

That means `#447` is not just a Teams-side design fork. It is a pre-decision research thread for how HelkinSwarm should represent organizational personhood once the virtual-company architecture becomes concrete.

## Sources reviewed in this pass

### Microsoft docs

- `https://learn.microsoft.com/graph/api/chatmessage-update?view=graph-rest-1.0`
- `https://learn.microsoft.com/graph/api/chatmessage-softdelete?view=graph-rest-1.0`
- `https://learn.microsoft.com/graph/api/chatmessage-undosoftdelete?view=graph-rest-1.0`
- `https://learn.microsoft.com/graph/api/chatmessage-setreaction?view=graph-rest-1.0`
- `https://learn.microsoft.com/graph/api/presence-setpresence?view=graph-rest-1.0`
- `https://learn.microsoft.com/graph/api/onlinemeeting-createorget?view=graph-rest-1.0`
- `https://learn.microsoft.com/graph/api/onlinemeeting-delete?view=graph-rest-1.0`
- `https://learn.microsoft.com/graph/permissions-reference#all-permissions`
- `https://learn.microsoft.com/graph/permissions-selected-overview#how-selected-scopes-work-with-sharepoint-and-onedrive-permissions`

### Public GitHub repos / references

- `https://github.com/OfficeDev/Microsoft-Teams-Samples`
- `https://github.com/microsoftgraph/msgraph-sdk-javascript`
- `https://github.com/microsoft/Agent365-nodejs`
- `https://github.com/microsoft/Agent365-Samples`
