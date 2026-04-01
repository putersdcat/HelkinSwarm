# HelkinSwarm Project Specification

## 10. Teams Interface (Refined)

### Overview

The Teams interface is the **only surface** the user interacts with. It must feel fast, natural, and powerful while enforcing every layer of the safety pipeline (0e), just-in-time skill memory (0i), durable hooks (0h), and multimodal context (0k) behind the scenes.

All communication flows through the Bot Framework, which forwards messages to the eternal overseer and handles proactive replies, Adaptive Card confirmations, and long-running workflow updates.

The interface is deliberately kept lightweight so the heavy lifting stays in the orchestrator and safety layers.

### Core Components

| Component                     | Location                              | Responsibility | Key Addendum Reference |
|-------------------------------|---------------------------------------|----------------|------------------------|
| **Bot Framework Adapter**     | `src/bot/adapter.ts`                  | MSI auth + Teams channel | — |
| **Activity Handler**          | `src/bot/HelkinSwarmBot.ts`           | Message routing, maintenance mode, ack management | — |
| **Human Confirmation**        | `src/bot/humanConfirmation.ts`        | Adaptive Card gates for destructive actions | 0e |
| **Conversation Store**        | `src/bot/conversationStore.ts`        | Stores references for proactive replies and durable hook updates (0h) | 0h |
| **Maintenance Mode**          | `src/bot/maintenanceMode.ts`          | Emergency stop + graceful offline replies | — |
| **Dev Console Tab**           | `/api/tab/dev-console`                | Owner-only deep inspection (sessions, traces, memory summary) | 0g |

### Message Flow (Updated)

```mermaid
graph TD
    A[User @HelkinSwarm in Teams] --> B[Bot Framework]
    B --> C[Activity Handler]
    C --> D[Ack "⌛ Working on it..."]
    D --> E[Raise NewMessage event to Overseer]
    E --> F[Overseer + Safety Pipeline (0e)]
    F --> G[Just-in-Time Skill Memory (0i) + Hydra-Net (0k)]
    G --> H[LLM + Tool Dispatch]
    H --> I[Durable Hooks Registration (0h) if long-running]
    I --> J[Send Reply Activity + Proactive Update]
    J --> K[Replace ack with final reply]
    style C fill:#1e3a8a,stroke:#60a5fa
```

1. User message arrives  
2. Bot Framework forwards to overseer  
3. Immediate ack sent (stored for later update)  
4. Full turn processed with safety (0e), skill memory (0i), and multimodal context (0k)  
5. If long-running, durable hook is registered (0h)  
6. Final reply sent proactively; ack is replaced in-place

### Asset-Bearing Replies

The proactive reply path must support **runtime asset references** in addition to plain text.

Current contract:
- `sendReplyActivity.ts` remains the authoritative outbound reply path
- text replies still use the normal ack-update + chunked send behavior
- when runtime asset references are supplied, the reply path resolves them at send time and emits Teams attachments with preserved metadata such as content type and filename
- attachment payload bytes must come from runtime asset storage, not from ad-hoc inline prompt blobs carried across orchestration steps

This keeps outbound file/image responses aligned with the runtime asset model introduced for attachment-bearing workflows.

### Idempotent Outbound Effects

Teams is only one ingress path into a larger side-effect system, so the chat layer must remain safe under retries and duplicate deliveries.

Current rule:
- user-visible or externally committed sends must claim a stable outbound-artifact idempotency key before emission
- duplicate retries must be suppressed instead of emitting the side-effect twice
- if delivery definitely failed before commit, the claim may be released

Today this primitive is used for:
- Teams replies (`reply`)
- confirmation cards (`confirmation-card`)
- Outlook email sends (`email-send`)

The shared claim store lives in `src/bot/conversationStore.ts`. See `docs/0t-Idempotency-and-External-Side-Effects.md` for the reusable pattern.

### Inbound Attachments

Inbound Teams attachments are no longer treated as an image-only side-channel.

Current contract:
- `HelkinSwarmBot.ts` ingests inbound Teams attachments before overseer handoff
- supported inbound files/images are persisted into runtime asset storage as structured references
- small inline images may also be exposed to the model as `imageUrls` for multimodal turns
- non-image files are represented to the model by prompt-safe asset summaries and references rather than raw inline bytes
- cold-start queued turns preserve the same inbound asset references and attachment-ingestion notices for replay

This keeps inbound file/image handling aligned with the same runtime asset transport used by downstream tools and outbound replies.

### Cold-Start and Wake-Up Behavior

When a message reaches the bot during the first few seconds after a cold start, HelkinSwarm must not silently drop it behind a vague "try again" response.

The current runtime contract is:

1. the personal copilot stamp keeps a warm floor for normal chat traffic, so the first post-idle turn should enter the normal ack path instead of depending on idle scale-to-zero wake-up behavior
2. if a message still lands during the explicit cold-start guard window (for example right after deploy/startup), persist the exact turn as a `pendingIntent`
3. immediately tell the user that the bot is waking up and that the message has been queued for automatic replay
4. attempt replay as soon as the cold-start window passes, with the existing pending-intent replay path as fallback

This reflects the current design decision from backlog work on `#393` / `#410`: for the main stamped personal copilot, reliable first-turn chat delivery beat idle scale-to-zero savings.

Startup lifecycle notices must also stay honest: a fresh "runtime online" notice is **not** proof that inbound Teams delivery has already succeeded. Until the first successful inbound `/api/messages` turn is observed, owner-facing startup notices should warn that inbound delivery is still being verified and that a no-reply first message may need to be resent.

Health honesty must also survive **post-idle** periods on warm stamps. If the runtime has gone a prolonged period without any successful inbound Teams turn, `/api/health` should degrade the message-path signal again rather than continuing to claim that inbound delivery is proven forever.

### Slash Commands (Handled Before Overseer)

| Command               | Access       | Action |
|-----------------------|--------------|--------|
| `/emergency-stop`     | Owner        | Immediate global shutdown |
| `/emergency-resume`   | Owner        | Restore service |
| `/forge <idea>`       | Owner        | Routes directly to SkillForge (0f) |
| `/heavy <prompt>`     | Owner        | Forces global frontier model |
| `/light <prompt>`     | Owner        | Forces fast global model |
| `/skillSearch ...`    | Any user     | Read-only browse/search over installed skills and tools |

`/skillSearch` is a **chat-participant-facing read-only discovery command**. It does not execute tools directly; it only helps the user inspect the installed capability surface.

This is intentionally distinct from the orchestrator-facing core tool `helkin_skill_search`, which exists for discovery-first routing inside the orchestration layer.

### Adaptive Cards & Confirmation UX

All human confirmations (medium/high-risk actions) use clean Adaptive Cards generated by `humanConfirmation.ts`:
- Clear impact description
- Risk level badge
- Approve / Cancel buttons
- 5-minute auto-timeout

Cards are sent via the ack-update mechanism so the conversation feels seamless.

### Teams Tab Experiences (Control Center)

The personal app includes static tabs for rich management. Tab hosting uses a **global SPA + per-stamp backends** pattern — see issue #107 for the architecture decision and `docs/0o-Microsoft-Teams-App-Expansion-with-Tabs.md` for the full implementation plan.

- **Get Started** – onboarding + quick commands (served from global SPA, data from stamp backend)
- **Control Center** – live sessions, model health, memory stats, cost overview (served from global SPA, data from stamp backend)
- **Dev Console** – owner-only deep inspection: session tracer, correlation search, durable hook status (0h), skill memory summary (0i), DevLoop relay status (0g) (served from global SPA, data from stamp backend)

The manifest's `{{TAB_HOST_URL}}` placeholder is substituted by `teams-package.yml` at build time with the global tab SPA URL.

### Key Files

| File | Responsibility |
|------|----------------|
| `src/bot/HelkinSwarmBot.ts` | Main activity handler |
| `src/bot/adapter.ts` | MSI auth factory |
| `src/bot/humanConfirmation.ts` | Confirmation card logic |
| `src/bot/conversationStore.ts` | Proactive reply + durable hook storage |
| `src/bot/maintenanceMode.ts` | Emergency stop flag |
| `src/functions/tab*.ts` | Tab API backends on stamps (GET endpoints returning tab data; front-end is the global SPA — see #107) |
| `tabs/` | Global SPA front-end source (Azure Storage static website — see #107) |

### What NOT to Do

- ❌ Never send messages directly with `turnContext.sendActivity()` outside the official reply path
- ❌ Never bypass the ack → update pattern for long-running operations (especially durable hooks)
- ❌ Never use Playwright or any browser automation to send test messages (use Teams Test Harness MCP only)
- ❌ Never expose raw orchestrator state or skill memory in the main chat — route to Dev Console tab