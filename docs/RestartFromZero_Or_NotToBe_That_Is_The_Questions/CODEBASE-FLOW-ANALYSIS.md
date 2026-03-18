# HelkinSwarm — End-to-End Message Flow Analysis

> **Generated:** 2026-03-17  
> **Mode:** STRICT CODEBASE ANALYSIS — every claim is grounded in actual source code files.  
> **No spec documents, design documents, or prior assumptions were used.**

---

## Files Consulted

Every file referenced below was explicitly read via tooling. Full list:

| # | File Path | Role |
|---|-----------|------|
| 1 | `src/functions/messages.ts` | HTTP trigger entry point |
| 2 | `src/functions/bootstrap.ts` | Startup subsystem initialisation |
| 3 | `src/bot/adapter.ts` | Bot Framework CloudAdapter factory |
| 4 | `src/bot/HelkinSwarmBot.ts` | TeamsActivityHandler (main bot logic) |
| 5 | `src/bot/conversationStore.ts` | ConversationReference cache + Cosmos write-through |
| 6 | `src/bot/humanConfirmation.ts` | Adaptive Card creation for confirmations |
| 7 | `src/bot/pendingMessageLedger.ts` | Restart-resilience message tracking |
| 8 | `src/bot/quotedReplyParser.ts` | Teams "Reply with quote" HTML parser |
| 9 | `src/bot/maintenanceMode.ts` | (referenced, not fully read — used by slash commands) |
| 10 | `src/config/environment.ts` | Zod-validated env config |
| 11 | `src/auth/identity.ts` | UAMI / DefaultAzureCredential factory |
| 12 | `src/auth/scopedTokenMinter.ts` | 5-min scoped token minter |
| 13 | `src/orchestrator/overseer.ts` | Eternal Overseer (Durable orchestration) |
| 14 | `src/orchestrator/sessionOrchestrator.ts` | Session Sub-Orchestrator (one turn) |
| 15 | `src/orchestrator/buildPromptActivity.ts` | Prompt assembly activity |
| 16 | `src/orchestrator/llmActivity.ts` | LLM call activity |
| 17 | `src/orchestrator/sendReplyActivity.ts` | Proactive reply to Teams activity |
| 18 | `src/orchestrator/toolDispatchActivity.ts` | Tool execution + safety pipeline |
| 19 | `src/orchestrator/subAgentActivity.ts` | Isolated sub-agent LLM session |
| 20 | `src/orchestrator/executorActivity.ts` | Non-LLM executor for high-risk ops |
| 21 | `src/orchestrator/verificationPipeline.ts` | Four-eyes verification (5 steps) |
| 22 | `src/orchestrator/summariseActivity.ts` | LLM-powered conversation summarisation |
| 23 | `src/orchestrator/stateActivities.ts` | Durable Functions state load/save wrappers |
| 24 | `src/orchestrator/stateManager.ts` | In-memory state store (Map-based) |
| 25 | `src/orchestrator/tokenBudget.ts` | Pure-logic token budget tracker |
| 26 | `src/orchestrator/durableHookActivity.ts` | Durable hook CRUD (Cosmos-backed) |
| 27 | `src/orchestrator/telemetryCollectorActivity.ts` | Per-turn telemetry aggregation |
| 28 | `src/orchestrator/resurrectionActivity.ts` | IDE idle detection + resurrection |
| 29 | `src/orchestrator/virtualEmployee/index.ts` | Virtual Employee module barrel |
| 30 | `src/orchestrator/virtualEmployee/types.ts` | Virtual Employee Zod schemas |
| 31 | `src/llm/foundryClient.ts` | Azure AI Foundry + OpenRouter BYOK client |
| 32 | `src/llm/modelRouter.ts` | Model selection logic (primary/secondary/embedding) |
| 33 | `src/llm/profileLoader.ts` | Model-specific tool presentation profiles |
| 34 | `src/llm/promptShields.ts` | Azure Content Safety integration |
| 35 | `src/tools/toolRegistry.ts` | Central tool registry + builtin handlers |
| 36 | `src/tools/handlers/github.ts` | GitHub issue management handlers |
| 37 | `src/capabilities/capabilityLoader.ts` | Skill manifest discovery + Zod validation |
| 38 | `src/memory/memoryManager.ts` | Memory facade (store, recall, JIT, vaults) |
| 39 | `src/memory/embeddingClient.ts` | text-embedding-3-large via Foundry |
| 40 | `skills/core/manifest.json` | Core skill manifest |
| 41 | `skills/github/manifest.json` | GitHub skill manifest |

---

## 1. How the Message First Enters the System

### 1.1 HTTP Trigger — `src/functions/messages.ts`

The Azure Functions HTTP trigger is registered at the bottom of the file:

```ts
app.http('messages', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'messages',
  extraInputs: [df.input.durableClient()],
  handler: messagesHandler,
});
```

When Teams sends a message, the `messagesHandler()` function executes:

1. **Bootstrap**: Calls `await bootstrap()` to ensure all subsystems (memory, tools, conversation cache) are initialised. This is critical after container restarts.

2. **Adapter creation**: Gets a singleton `CloudAdapter` via `getAdapter()` → `createAdapter()` in `src/bot/adapter.ts`.

3. **Durable client**: Extracts the Durable Functions client from `df.getClient(context)`.

4. **Bot instantiation**: Creates a new `HelkinSwarmBot` instance, injecting `createDurableRaiseEvent(durableClient)` as the event callback.

5. **Type bridging**: Converts the Azure Functions v4 `HttpRequest` (Fetch API) to botbuilder's expected `{ body, headers, method }` via `toBotRequest(req)`, and creates a response shim via `createResponseShim()`.

6. **Processing**: Calls `adapter.process(botReq, botRes, callback)` which handles JWT validation, activity deserialization, and turn context creation.

### 1.2 Bot Framework Adapter — `src/bot/adapter.ts`

```ts
export function createAdapter(): CloudAdapter {
  const config = getConfig();
  const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: config.MICROSOFT_APP_ID,
    MicrosoftAppType: config.MICROSOFT_APP_TYPE,
    MicrosoftAppTenantId: config.MICROSOFT_APP_TENANT_ID,
  });
  const adapter = new CloudAdapter(botFrameworkAuth);
```

Uses User-Assigned Managed Identity authentication. Has a global `onTurnError` handler that sends a user-friendly error back to Teams.

### 1.3 HelkinSwarmBot — `src/bot/HelkinSwarmBot.ts`

The `onMessage` handler in the constructor runs the following steps in sequence:

1. **Save conversation reference** — `saveConversationReference()` from `src/bot/conversationStore.ts` persists the Bot Framework `ConversationReference` both in-memory (Map) and fire-and-forget to Cosmos DB. This is essential for proactive reply delivery later.

2. **Adaptive Card check** — Tests `context.activity.value` and runs `parseConfirmationResponse()` from `src/bot/humanConfirmation.ts`. If it's a confirmation card submission, routes to `handleConfirmationResponse()` and returns early.

3. **Text cleanup** — Strips DevLoop probe correlation tags (regex: `/^\[(?:probe|DL)-[^\]]+\]\s*/i`).

4. **Quoted reply detection** — Calls `parseQuotedReply(context.activity)` from `src/bot/quotedReplyParser.ts` which extracts `<blockquote>` HTML content from Teams "Reply with quote" messages. Extracts author type (bot/user/unknown) for trust level, original message ID, and strips the quote from the user's text.

5. **Slash command routing** — If text starts with `/`, calls `handleSlashCommand()` which handles: `/help`, `/health`, `/heavy`, `/light`, `/reload`, `/spawn`, `/employees`, `/kill-employee`, `/forge`, `/dev-console`, `/emergency-stop`, `/emergency-resume`, `/link`, `/unlink`. **These are all handled locally — they never reach the overseer.**

6. **Maintenance mode check** — If `isMaintenanceMode()` is true, sends the maintenance message and returns.

7. **Ack → Update pattern** — Generates a `correlationId` via `randomUUID()`, sends an immediate acknowledgment (random from `ACK_MESSAGES` array like "⏳ Working on it…") and captures the `ackActivityId`.

8. **Build NewMessageEvent** — Constructs the event payload:
   ```ts
   const event: NewMessageEvent = {
     type: 'NewMessage',
     correlationId,
     conversationId,
     userId,
     displayName,
     aadObjectId,
     tenantId,
     text,
     timestamp: new Date().toISOString(),
     ackActivityId,
     quotedEvidence: quoteResult.evidence,
   };
   ```

9. **Record pending** — Calls `recordPending()` (fire-and-forget) for restart resilience. Writes to Cosmos `pendingMessages` container with 1-hour TTL.

10. **Track telemetry** — Calls `trackTurnStarted()`.

11. **Raise event** — Calls `this.raiseEvent('NewMessage', event)` which is the injected `createDurableRaiseEvent()` callback.

### 1.4 Durable Event Raising — `src/functions/messages.ts` → `createDurableRaiseEvent()`

The `createDurableRaiseEvent()` function bridges the bot to the eternal overseer:

1. **Instance ID**: Computes a deterministic overseer instance ID via `getOverseerInstanceId(userId, conversationId)` — SHA-256 hash of `${userId}:${conversationId}`, truncated to 32 hex chars, prefixed with `overseer-`.

2. **Status check**: Calls `durableClient.getStatus(instanceId)`. Handles 404 (not found) gracefully.

3. **Start if needed**: If the instance doesn't exist, is Completed, Terminated, or Failed, starts a new one via `durableClient.startNew('overseerOrchestrator', { instanceId, input: undefined })`. Then polls every 500ms for up to 5 seconds until the instance reaches `Running` status.

4. **Raise event with retry**: Raises the external event up to 3 times, verifying delivery between attempts by checking if `customStatus` contains "Processing". This guards against the brief window during `ContinueAsNew` where events can be lost.

---

## 2. What the Main Orchestrator Does

### 2.1 Eternal Overseer — `src/orchestrator/overseer.ts`

Registered as:
```ts
df.app.orchestration('overseerOrchestrator', overseerOrchestration);
```

The overseer is a **generator function** (Durable Functions deterministic orchestration). Its lifecycle:

**Fresh start (no state):**
1. Sets custom status to "Waiting for first message (no state)"
2. `yield context.df.waitForExternalEvent('NewMessage')` — blocks until the first message arrives
3. Constructs fresh `OverseerState`: `{ userId, conversationId, summary: '', tokenCount: 0, restartCount: 0, activeHookIds: [] }`
4. Calls `processNewMessage()` → `checkBudgetAndContinue()` → always calls `context.df.continueAsNew(state)`.

**Subsequent cycles (state carried via ContinueAsNew input):**
1. Reads state from `context.df.getInput() as OverseerState`
2. Enters an event-waiting loop with a 10-minute timeout and max 6 idle cycles (1 hour total idle time)
3. Races three tasks: `waitForExternalEvent('NewMessage')`, `waitForExternalEvent('DurableHookCallback')`, and a `createTimer(deadline)`
4. On **NewMessage**: resets idle counter, calls `processNewMessage()` → `checkBudgetAndContinue()`
5. On **DurableHookCallback**: resets idle counter, calls `processHookCallback()` → `checkBudgetAndContinue()`
6. On **timeout**: increments idle counter. After 6 consecutive idle cycles, saves state and terminates (parks).

**`processNewMessage()`** (generator function):
- Wraps the message in `SessionTurnInput` with the current summary and prior token count
- `yield context.df.callSubOrchestrator('sessionOrchestrator', turnInput)`
- Updates `state.tokenCount`, `state.summary`, and `state.lastTurnTimestamp` from `SessionTurnResult`
- On failure: sends an error reply via `sendReplyActivity` — the overseer itself stays alive

**`processHookCallback()`** (generator function):
- Calls `matchHookActivity` to find a matching durable hook
- If matched: removes the hook from `state.activeHookIds`, synthesises a `NewMessageEvent` with hook context text, and processes it through `processNewMessage()`

**`checkBudgetAndContinue()`** (generator function):
- Calls `checkTokenBudget(state.tokenCount, model)` (pure math — `src/orchestrator/tokenBudget.ts`)
- If budget ≥ 80% of context window: calls `summariseActivity`, saves state, then `context.df.continueAsNew(newState)` with reset token count
- If under budget: saves state, then `context.df.continueAsNew(state)`
- **The overseer ALWAYS calls ContinueAsNew — it never terminates during active use**

---

## 3. Session Sub-Orchestrator

### 3.1 `src/orchestrator/sessionOrchestrator.ts`

Registered as:
```ts
df.app.orchestration('sessionOrchestrator', sessionOrchestrator);
```

This is a **real, separate Durable Functions sub-orchestrator** called via `callSubOrchestrator`. It handles one complete user turn. Steps:

**Step 1 — Build Prompt:**
- Calls `buildPromptActivity` with `{ userMessage, summary, userId, displayName, aadObjectId, tenantId, correlationId, quotedEvidence }`

**Step 2 — Call LLM:**
- Calls `llmActivity` with `{ model, messages, correlationId }`

**Step 3 — Tool Dispatch Loop (up to 5 rounds):**
- While `llmResult.toolCalls.length > 0` and `toolRound < MAX_TOOL_ROUNDS` (5):
  - For each tool call: calls `toolDispatchActivity` with `{ toolCall, userId, conversationId, ackActivityId, correlationId }`
  - Appends assistant message with `tool_calls` to `conversationMessages`
  - Appends tool results as `role: 'tool'` messages
  - Calls `llmActivity` again with the full conversation including tool results
  - Accumulates token counts

**Step 4 — Collect Telemetry:**
- Calls `telemetryCollectorActivity` with all timing data, token counts, tool call info, safety flags

**Step 5 — Send Reply:**
- Calls `sendReplyActivity` with `{ conversationId, ackActivityId, text, correlationId, turnMeta, telemetry }`

**Step 6 — Build Summary:**
- Appends `[user] <text>\n[assistant] <response>` to the existing summary

**Return:** `SessionTurnResult { responseText, tokensUsed, updatedSummary, correlationId }`

**Error handling:** Catches all errors, sends error message to user via `sendReplyActivity`, returns degraded result (tokensUsed=0, summary unchanged).

---

## 4. Intent Triage, Skill Selection, and Tool Dispatch

### 4.1 There Is No Explicit Intent Triage or Skill Selection Layer

I do not see any explicit "intent classification" step, "skill router", or "triage" component in the codebase. **The LLM itself performs all intent triage implicitly** via its tool-calling capabilities:

- **`buildPromptActivity`** (`src/orchestrator/buildPromptActivity.ts`) injects all available tools into the system prompt as `[Available Tools]` context with name, description, and risk level
- The LLM decides which tools to call (or none) based on the user's message
- There is no pre-LLM classifier, no intent enum, no routing table

### 4.2 Tool Presentation

Tools are discovered at bootstrap via two paths:

1. **`capabilityLoader.ts`** scans:
   - `skills/*/manifest.json` (currently: `skills/core/manifest.json` and `skills/github/manifest.json`)
   - `src/capabilities/manifests/*.json` (this directory does not currently exist in the workspace)

2. Each manifest is Zod-validated against `capabilityManifestSchema`, tools are registered in the `_registry` Map in `toolRegistry.ts`.

3. **`registerBuiltinHandlers()`** in `toolRegistry.ts` overrides stub handlers with real implementations for: `helkinswarm_health`, `helkinswarm_set_safety_mode`, `helkinswarm_web_search`, `helkinswarm_recall_memory`, `helkinswarm_store_memory`, `github_list_issues`, `github_view_issue`, `github_create_issue`, `github_comment_issue`, `github_close_issue`.

4. **Model-specific masking**: `getModelProfile(model)` in `profileLoader.ts` loads mask files from `model-profiles/<model>/mask.json`. `applyToolMask()` limits tools per turn, applies category priorities, etc.

### 4.3 Tool Dispatch — `src/orchestrator/toolDispatchActivity.ts`

For each LLM-requested tool call:

1. **Lookup**: `getToolDefinition(toolCall.name)` and `getToolHandler(toolCall.name)` from the registry
2. **Scoped token minting**: `mintScopedToken(toolCall.name, toolDef.requiredScopes, correlationId)` — mints a 5-minute token. If `requiredScopes` is non-empty, acquires a real Azure token via UAMI; otherwise mints a signed placeholder token.
3. **Token verification**: `verifyScopedToken(scopedToken)` — checks expiry
4. **Execution**: Parses JSON arguments, injects `userId` and `correlationId`, calls the handler. If `toolDef.requiresExecutor` is true, **currently still executes directly** (the code has a comment: "Phase 3+ will route to executorActivity for true isolation")
5. **Verification pipeline**: `runVerificationPipeline()` on the raw output

---

## 5. Sub-Agent Isolation

### 5.1 `subAgentActivity` — `src/orchestrator/subAgentActivity.ts`

The sub-agent activity **exists and is fully implemented**, but **I do not see it being called anywhere in the current session orchestrator flow**.

Searching the codebase for callers of `subAgentActivity`:
- It is **registered** as a Durable Functions activity
- It is **imported** by the overseer (side-effect import in `overseer.ts`)
- But it is **never `yield context.df.callActivity('subAgentActivity', ...)`** in `sessionOrchestrator.ts` or `toolDispatchActivity.ts`

The `subAgentActivity` handler, if called, would:
- Resolve the **secondary model** via `resolveModel({ role: 'secondary' })`
- Build an isolated prompt with zero conversation history: `"You are a focused sub-agent of HelkinSwarm. You have ONE task to complete."`
- Call `chatCompletion()` with **no tools** (sub-agents cannot call tools recursively)
- Scan output through Prompt Shields
- Return `SubAgentResult`

**Current reality: tool call routing in `toolDispatchActivity` does NOT check `toolDef.requiresSubAgent`. All tools, regardless of their `requiresSubAgent` flag, execute their handler function directly.**

### 5.2 `executorActivity` — `src/orchestrator/executorActivity.ts`

The executor activity also **exists and is fully implemented** as a Durable Functions activity, but **is never called from the session orchestrator or tool dispatch flow**.

In `toolDispatchActivity.ts`, the code for `requiresExecutor` tools says:
```ts
if (toolDef.requiresExecutor) {
  // For now, we execute directly with scoped token
  // Phase 3+ will route to executorActivity for true isolation
  const result = await handler(args, scopedToken.token);
  rawOutput = JSON.stringify(result);
}
```

The executor's internal routing has **stub implementations**:
```ts
async function executeDelete(...): Promise<...> {
  return {
    action: 'delete',
    status: 'stub',
    message: 'Phase 3 stub — delete not connected to real API',
  };
}
```

---

## 6. Safety Checks, Scoped Token Minting, Verification Steps

### 6.1 Prompt Shields (Pre-LLM Scan) — `src/llm/promptShields.ts`

In `llmActivity.ts`, **before** the LLM call:
```ts
const shieldResult = await scanUserMessage(userMessage, input.correlationId);
```

- Uses Azure Content Safety API (`/contentsafety/text:shieldPrompt`) with UAMI auth
- If no `AZURE_CONTENT_SAFETY_ENDPOINT` configured: **fail-open** (passes all content, logs warning)
- If blocked: returns `{ responseText: '⚠️ Your message was flagged...', finishReason: 'content_filter', toolCalls: [] }` — the LLM is never called

### 6.2 Scoped Token Minting — `src/auth/scopedTokenMinter.ts`

Every tool execution in `toolDispatchActivity` gets a fresh scoped token:

- **5-minute TTL** (`TOKEN_TTL_MS = 5 * 60 * 1000`)
- If `requiredScopes` is non-empty: acquires a real token via `credential.getToken()` (maps scopes to Azure resources like `https://graph.microsoft.com/.default`)
- If no scopes: mints a signed placeholder `helkinswarm:<toolName>:<correlationId>:<uuid>:<hmac>` using `TOKEN_SIGNING_KEY` env var
- Token is verified with `verifyScopedToken()` before execution

### 6.3 Verification Pipeline — `src/orchestrator/verificationPipeline.ts`

Runs on EVERY tool output in `toolDispatchActivity`. Five sequential steps:

1. **Schema Validation**: Parses tool output as JSON, checks against `tool.outputSchema`. If no schema defined: passes (with warning). Checks required properties exist.

2. **Data Minimization**: Strips every field NOT in `outputSchema.properties`. Reduces token usage and attack surface.

3. **Spot-Check Verification**: If `tool.skipSpotCheck === false`:
   - Structural validation: count consistency, non-null items
   - Source-verified check: calls `getSpotCheckVerifier(toolName)` callback if registered
   - Currently registered verifiers: `helkinswarm_recall_memory` and `helkinswarm_store_memory`

4. **Prompt Shields (Output Scan)**: `scanSubAgentOutput(minimized.data, correlationId)` — scans tool output through Azure Content Safety as a "document"

5. **Risk-Tiered Human Confirmation**: `requiresConfirmation(toolName)` checks:
   - High-risk tools: **always** require confirmation
   - `skipConfirmation` flag from manifest: skips for low/medium
   - `confirmation-gated` safety mode: medium tools require confirmation
   - `full-destructive` mode: only high-risk requires confirmation

**Important**: Step 5 currently **records** that confirmation is required but **does not** block execution to wait for it. The code says: "The actual confirmation flow (sending Adaptive Card, waiting for response) is handled by the overseer via external events. Here we just record that it's required."

### 6.4 Human Confirmation Cards — `src/bot/humanConfirmation.ts`

`createConfirmationCard()` builds an Adaptive Card with Approve/Cancel buttons. The card includes risk level badge, action description, correlation ID. But this function is **defined** but **not called from the verification pipeline or tool dispatch flow in the current code**.

The bot's `onMessage` handler DOES check for card submissions via `parseConfirmationResponse()`, and there's a `handleConfirmationResponse()` method — so the receiving end is wired up, but the **sending side in the pipeline is not connected**.

---

## 7. Memory Loading, Durable Hooks, Just-in-Time Injection

### 7.1 Just-in-Time Memory Injection — `src/orchestrator/buildPromptActivity.ts`

In the prompt building activity, after injecting the system persona, user context, conversation summary, tool declarations, and model limitations:

```ts
const jitContext = await getJitContext(input.userId, input.userMessage);
if (jitContext.length > 0) {
  messages.push({
    role: 'system',
    content: jitContext,
  });
}
```

`getJitContext()` in `src/memory/memoryManager.ts`:
- Calls `recall(userId, query, { topK: 5 })` which performs DiskANN vector similarity search
- Generates an embedding for the user's current message via `generateEmbedding()`
- Runs a Cosmos DB query using `VectorDistance(c.embedding, @embedding)` ordered by similarity
- Filters results with `score > 0.3`
- Returns formatted string: `[Relevant Memories]\n- [category] content (relevance: XX%)`

If Cosmos is not configured: returns empty results (graceful degradation).

### 7.2 User Profile Touch — `src/memory/userProfileStore.ts`

Also in `buildPromptActivity`:
```ts
const profileResult = await touchUserProfile({
  userId: input.userId,
  displayName: input.displayName,
  aadObjectId: input.aadObjectId,
  tenantId: input.tenantId,
});
```

If `profileResult.isFirstEncounter`, injects a system message: "This is a **brand-new user** — their first ever interaction with you." Otherwise includes message count and first-seen date.

### 7.3 Conversation Summary Injection

The conversation summary (carried across `ContinueAsNew` cycles) is injected as:
```ts
if (input.summary.length > 0) {
  messages.push({
    role: 'system',
    content: `[Conversation Summary]\n${input.summary}`,
  });
}
```

### 7.4 Quoted Reply Evidence Injection

If the user replied with a quote (parsed from HTML blockquote):
```ts
if (input.quotedEvidence?.text) {
  // Injects as [Quoted Evidence — Trusted (bot-authored)] or similar
  // with author name, message ID, and the quoted text
}
```

### 7.5 Durable Hooks — `src/orchestrator/durableHookActivity.ts`

Full Cosmos-backed implementation with:
- `durableHookHandler` — registers hooks with auto-expire TTL
- `listHooksHandler` — queries active hooks by userId
- `cancelHookHandler` — sets status to 'cancelled'
- `matchHookHandler` — fuzzy pattern matching for trigger events

The overseer races `waitForExternalEvent('DurableHookCallback')` alongside new messages. When a hook fires, it synthesises a system message and processes it through the same session orchestrator path.

However, I see **no code path that actually registers hooks on behalf of the LLM**. The durable hook activity can be called, and the overseer listens for hook callbacks, but there is no tool or mechanism in the session orchestrator that creates hooks during a conversation turn.

### 7.6 Summarisation — `src/orchestrator/summariseActivity.ts`

When the token budget hits 80%:
- Uses the **secondary model** via `resolveModel({ role: 'secondary' })`
- Prompt: "You are a conversation summariser. Condense the following conversation..."
- Trims input to max 24,000 chars
- Falls back to truncation if LLM call fails
- Returns: `{ summary, summaryTokenCount }`

### 7.7 State Management — `src/orchestrator/stateManager.ts`

**Currently uses an in-memory Map** (`stateStore = new Map<string, OverseerState>()`):
```ts
export async function loadOverseerState(userId, conversationId): Promise<OverseerState> {
  const key = stateKey(userId, conversationId);
  const existing = stateStore.get(key);
  if (existing) return existing;
  // Create fresh state
  return { userId, conversationId, summary: '', tokenCount: 0, ... };
}
```

This means **state is lost on container restart**. The code comments say "Phase 4: Replace with Cosmos DB `sessionState` container."

---

## 8. How Replies Are Sent Back to Teams

### 8.1 `sendReplyActivity` — `src/orchestrator/sendReplyActivity.ts`

Activity function that:

1. **Bootstrap check**: Calls `bootstrap()` in case the worker process was recycled.

2. **Retrieve conversation reference**: `getConversationReference(input.conversationId)` from the in-memory cache (warmed from Cosmos at startup).

3. **Debug telemetry append**: If `DEBUG_TELEMETRY_ENABLED`, appends formatted telemetry (timing, tokens, model info) to the reply text.

4. **Proactive reply**: Creates a fresh adapter and calls `adapter.continueConversationAsync()`:
   - **If ackActivityId is set**: Updates the "⏳ Working on it..." message in-place via `context.updateActivity({ id: ackActivityId, type: 'message', text: replyText })`
   - **If update fails** (message expired, etc.): Falls back to `context.sendActivity(replyText)` as a new message

5. **Telemetry**: Tracks reply delivery, turn completion, cost estimation, caches telemetry for DevLoop.

6. **Pending message ledger**: `markCompleted(correlationId, conversationId)` — updates the Cosmos record to `status: 'completed'`.

---

## 9. Full End-to-End Flow Summary

```
Teams User Message
    │
    ▼
POST /api/messages (Azure Functions HTTP trigger)
    │
    ├─ bootstrap() — init memory, tools, conversation cache
    │
    ▼
CloudAdapter.process() — JWT validation + turn context
    │
    ▼
HelkinSwarmBot.onMessage()
    ├─ saveConversationReference() → cache + Cosmos
    ├─ parseConfirmationResponse() → if card submission, handle + return
    ├─ strip DevLoop tags
    ├─ parseQuotedReply() → extract blockquote evidence
    ├─ slash command? → handle locally + return
    ├─ maintenance mode? → reply + return
    ├─ sendActivity("⏳ Working on it…") → ackActivityId
    ├─ build NewMessageEvent
    ├─ recordPending() → Cosmos (fire-and-forget)
    ├─ trackTurnStarted()
    └─ raiseEvent('NewMessage', event)
                │
                ▼
        createDurableRaiseEvent()
            ├─ getOverseerInstanceId() → SHA-256 hash
            ├─ getStatus() → check if running
            ├─ startNew() if needed → poll until Running
            └─ raiseEvent() with 3x retry + delivery verification
                    │
                    ▼
            overseerOrchestrator (Durable Functions)
                ├─ waitForExternalEvent('NewMessage')
                ├─ processNewMessage()
                │       │
                │       ▼
                │   callSubOrchestrator('sessionOrchestrator')
                │       │
                │       ├─ buildPromptActivity
                │       │   ├─ resolveModel({ role: 'primary' })
                │       │   ├─ Build system persona with deployment context
                │       │   ├─ touchUserProfile() → new/returning user context
                │       │   ├─ Inject conversation summary
                │       │   ├─ getFilteredTools() → applyToolMask() → model profile
                │       │   ├─ getModelLimitations() → self-awareness
                │       │   ├─ getJitContext() → DiskANN vector search
                │       │   ├─ Inject quoted evidence (if present)
                │       │   └─ Add user message
                │       │
                │       ├─ llmActivity
                │       │   ├─ scanUserMessage() → Prompt Shields (pre-LLM)
                │       │   ├─ If blocked → return content_filter
                │       │   ├─ getToolsForLlm() + applyToolMask()
                │       │   └─ chatCompletion() → Foundry/OpenRouter
                │       │
                │       ├─ [Tool Loop: max 5 rounds]
                │       │   ├─ toolDispatchActivity (per tool call)
                │       │   │   ├─ getToolDefinition() + getToolHandler()
                │       │   │   ├─ mintScopedToken()
                │       │   │   ├─ verifyScopedToken()
                │       │   │   ├─ handler(args, scopedToken.token)
                │       │   │   └─ runVerificationPipeline()
                │       │   │       ├─ 1. Schema Validation
                │       │   │       ├─ 2. Data Minimization
                │       │   │       ├─ 3. Spot-Check Verification
                │       │   │       ├─ 4. Prompt Shields (output)
                │       │   │       └─ 5. Human Confirmation check
                │       │   │
                │       │   ├─ Append assistant+tool messages
                │       │   └─ llmActivity (follow-up with tool results)
                │       │
                │       ├─ telemetryCollectorActivity → aggregate timings
                │       │
                │       ├─ sendReplyActivity
                │       │   ├─ getConversationReference()
                │       │   ├─ Optional: append debug telemetry
                │       │   ├─ continueConversationAsync()
                │       │   │   └─ updateActivity(ackActivityId) or sendActivity()
                │       │   └─ markCompleted() → Cosmos
                │       │
                │       └─ return SessionTurnResult
                │
                ├─ Update state (tokenCount, summary)
                ├─ checkBudgetAndContinue()
                │   ├─ If ≥80%: summariseActivity → saveState → ContinueAsNew
                │   └─ If <80%: saveState → ContinueAsNew
                └─ [Overseer loops forever]
```

---

## 10. Gaps, Stubs, Incomplete Parts, and Missing Layers

Based solely on what I actually see in the files right now:

### 🔴 Critical Gaps

1. **State Manager is in-memory only** (`src/orchestrator/stateManager.ts`)
   - Uses `new Map<string, OverseerState>()` — state is lost on every container restart
   - Comments say "Phase 4: Replace with Cosmos DB sessionState container" but this has NOT been done
   - This means conversation context (summary, token count) is lost on any container recycle

2. **Sub-Agent Activity is never invoked**
   - `subAgentActivity` exists in `src/orchestrator/subAgentActivity.ts` with full implementation
   - Tool definitions declare `requiresSubAgent: true/false` in manifests
   - But `toolDispatchActivity.ts` and `sessionOrchestrator.ts` **never check `requiresSubAgent`** and **never call `subAgentActivity`**
   - All tools execute directly in the tool dispatch activity, regardless of their `requiresSubAgent` flag

3. **Executor Activity is never invoked**
   - `executorActivity` exists in `src/orchestrator/executorActivity.ts` with payload signing, hash verification
   - In `toolDispatchActivity.ts`, when `toolDef.requiresExecutor` is true, the code says: *"For now, we execute directly with scoped token — Phase 3+ will route to executorActivity for true isolation"*
   - The executor's internal `routeExecution()` has **stub implementations** for delete/move/create/admin that return "Phase 3 stub" messages

4. **Human Confirmation cards are never sent**
   - `createConfirmationCard()` and `createTimeoutCard()` exist in `src/bot/humanConfirmation.ts`
   - The verification pipeline checks `requiresConfirmation()` and records it in the result
   - But **no code sends the card to the user or blocks execution to wait for the response**
   - The verification pipeline's step 5 says: "Here we just record that it's required" — it passes the result through as-is
   - The confirmation card **receiving** side IS wired (the bot parses card submissions), but the **sending** side is disconnected

### 🟡 Partial Implementations

5. **Web search tool returns empty results**
   - `helkinswarm_web_search` handler in `toolRegistry.ts`:
     ```ts
     return { results: [], message: `Web search not yet connected. Query: "${query}"` };
     ```

6. **`helkinswarm_health` returns a static stub**
   - Handler: `return { status: 'healthy', message: 'All systems operational' }` — no actual component health checks

7. **Durable hooks have no creation path from conversation**
   - The durable hook infrastructure (register, list, cancel, match, callback processing in overseer) is fully built
   - But there is **no tool** in any manifest that calls `durableHookHandler` to register a hook
   - The LLM has no way to create durable hooks during a conversation turn

8. **Virtual Employee containers are never provisioned**
   - `/spawn` command creates a registry record via `spawnEmployeeHandler()`
   - The confirmation message says: "Phase 1: Record created in catalog. No container provisioned yet."
   - The `aciManager.ts` in `src/skillforge/` exists but no provisioning is called from `/spawn`

9. **SkillForge shows informational message only**
   - `/forge` command just replies "SkillForge is available" or "disabled" — no actual skill creation flow

10. **Embedding client falls back to zero-vectors**
    - When `AZURE_AI_FOUNDRY_ENDPOINT` is not configured, `generateEmbedding()` returns `new Array(3072).fill(0)`
    - This means JIT memory injection via DiskANN would return useless results (all zero vectors have identical distance)

### 🟢 Flattened Paths (Working but Simplified)

11. **No intent classification layer** — The LLM is the sole decision-maker for tool selection. There is no pre-routing, no triage model, no skill preference scoring.

12. **Tool dispatch is serialised** — In the session orchestrator, tool calls within a single round are dispatched sequentially in a `for` loop, not in parallel via `context.df.Task.all()`.

13. **Summary is string concatenation** — The `updatedSummary` is built by simple concatenation: `summary + "\n\n[user] text\n[assistant] response"`. The LLM-powered `summariseActivity` only runs when the budget threshold is hit.

14. **Safety mode `read-only` filters tools at presentation** — Low-risk tools only are shown to the LLM. But there is no runtime enforcement at dispatch time that prevents a hallucinated tool name from being looked up.

15. **`TOKEN_SIGNING_KEY` will throw at runtime** — `getSigningKey()` throws `new Error('TOKEN_SIGNING_KEY environment variable is required')` if not set. This would crash any scoped token mint for tools with empty `requiredScopes`.
    - **Actually**: looking more carefully, `mintPlaceholderToken()` calls `signPayload()` which calls `getSigningKey()`. If `TOKEN_SIGNING_KEY` is not set, minting placeholder tokens for no-scope tools would throw.

16. **Memory tools (`recall`/`store`) work via MemoryManager** — Real Cosmos/DiskANN implementation exists but degrades gracefully to stubs. The full chain (embed → Cosmos → DiskANN vector search) works when configured.

17. **Fallback routing to OpenRouter is functional** — When Azure Foundry fails after retries and `OPENROUTER_API_KEY` is set, it falls back to per-lane fallback models via OpenRouter. This is fully implemented.

18. **Pending message ledger is fully functional** — Restart resilience via Cosmos `pendingMessages` container with reconciliation at bootstrap.

### ⚪ Missing Entirely (No Code At All)

19. **No response streaming** — All LLM responses are waited for in full before sending to Teams. No SSE, no partial updates.

20. **No rate limiting per user** — No per-user request throttling at any layer.

21. **No conversation turn history** — The session orchestrator does not load prior turns from storage. The only history available is the carry-over `summary` string. Tool call results from prior turns are not available.

22. **No proactive model switching within a turn** — The model is resolved once in `buildPromptActivity` and used for the entire turn including all tool follow-up rounds.

23. **No OBO token flow in tool execution** — `oboProvider.ts` exists and handles OAuth sign-in, but tool handlers receive the **app's scoped token** (UAMI), not the user's delegated token. The OBO exchange happens at sign-in time via `/link` but is not threaded through to tool dispatch.
