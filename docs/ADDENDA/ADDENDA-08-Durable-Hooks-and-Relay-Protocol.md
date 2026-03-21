# HelkinSwarm Project Specification — Addendum Series

## ADDENDA-08. Durable Hooks & Relay Protocol

**Version:** 1.0  
**Date:** March 2026  
**Status:** Implementation spec  
**References:** Doc `0h` (Long-Running Workflows), doc `0g` (Bidirectional Communication), doc `0e` (Safety Verification Pipeline), issue #71 (Epic), #72, #91

---

## 1. Purpose

Doc `0h` describes the vision for durable hooks (persistent follow-up handlers that survive `ContinueAsNew` context resets) and long-running workflow patterns. This addendum specifies the exact implementation: the `longRunningCatalog` Cosmos container schema, the external event wiring between hook triggers and the orchestrator, the `ide-messages` relay container, and the watchdog/heartbeat protocol for session resurrection.

---

## 2. Durable Hook Engine

### 2.1 Overview

```
Hook Trigger (webhook, Graph subscription, timer)
  │
  ▼
Azure Event Grid / Logic Apps webhook endpoint
  │
  ▼
raiseEvent('HookFired', { hookId, payload }) ──► Durable Orchestrator (resumed)
  │
  ▼
Hook handler activity
  │
  ├─► Confirmation card if risky
  ├─► Tentative action if safe
  └─► Memory update
```

### 2.2 longRunningCatalog Container

```typescript
// filepath: src/memory/memoryManager.ts (existing container constant)
const CATALOG_CONTAINER = 'longRunningCatalog';

// filepath: src/orchestrator/durableHookActivity.ts (existing — Phase 3/4 stub to implement)
```

Partition key: `userId`

Document schema:
```typescript
interface DurableHookDocument {
  id: string;                    // hookId — UUID v4
  userId: string;                // partition key
  skillDomain: string;            // "outlook", "github", etc.
  hookType: string;               // "webhook", "graphSubscription", "timer", "exchangeRule"
  
  // What to do when fired
  originalIntent: string;         // The user intent that created this hook
  expectedReplyPattern?: {        // For inbox-reply matching
    regex?: string;
    semantic?: string;           // Semantic search query for LLM fuzzy match
    sender?: string;             // Expected sender email
    subjectContains?: string;    // Subject line keyword
  };
  
  // Lifecycle
  triggerConfig: {
    type: 'webhook' | 'graphSubscription' | 'timer' | 'exchangeRule';
    endpoint?: string;            // Webhook receiver URL
    subscriptionId?: string;      // Graph subscription ID
    monitoredEmail?: string;       // For inbox-watch hooks
    monitoredThread?: string;      // For Teams thread-watch
    cronExpression?: string;       // For timer hooks
  };
  
  createdAt: string;              // ISO 8601
  expiresAt: string;              // ISO 8601 — max hook lifetime
  lastFiredAt?: string;           // ISO 8601
  status: 'active' | 'paused' | 'expired' | 'cancelled';
  
  // Safety
  riskLevel: 'low' | 'medium' | 'high';
  autoConfirm: boolean;            // If true, skip confirmation card for this hook
  
  // External reference
  externalReferenceId?: string;   // Graph subscription ID, Exchange rule ID, etc.
  
  // Correlation
  correlationId: string;           // cc-XXXXXXXX — threading back to original turn
}
```

TTL: No TTL on catalog — hooks manage their own expiration via `expiresAt`.

### 2.3 Hook Registration Flow

```typescript
// filepath: src/orchestrator/durableHookActivity.ts (Phase 3/4 implementation target)

export async function registerDurableHook(
  input: RegisterHookInput,
): Promise<RegisterHookResult> {
  const container = getContainer(CATALOG_CONTAINER);
  
  // Idempotency key: prevent duplicate hook registration
  const idempotencyKey = `${input.userId}-${input.hookType}-${input.triggerConfig.subscriptionId ?? input.triggerConfig.endpoint ?? ''}`;
  
  const hookDoc: DurableHookDocument = {
    id: crypto.randomUUID(),
    userId: input.userId,
    skillDomain: input.skillDomain,
    hookType: input.hookType,
    originalIntent: input.originalIntent,
    expectedReplyPattern: input.expectedReplyPattern,
    triggerConfig: input.triggerConfig,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + input.ttlMinutes * 60 * 1000).toISOString(),
    status: 'active',
    riskLevel: input.riskLevel,
    autoConfirm: input.autoConfirm ?? false,
    correlationId: input.correlationId,
  };
  
  await container.items.upsert(hookDoc);
  
  // Register external listener (Graph subscription, webhook endpoint, etc.)
  await registerExternalListener(hookDoc);
  
  // Add hookId to orchestrator state so it survives ContinueAsNew
  // This is done by the caller (overseer) which reads the returned hookId
  // and adds it to state.pendingHooks[]
  
  return { registered: true, hookId: hookDoc.id };
}
```

### 2.4 Hook State Survives ContinueAsNew

```typescript
// filepath: src/orchestrator/stateManager.ts

// OverseerState.pendingHooks carries hook IDs through ContinueAsNew
export interface OverseerState {
  // ...other fields...
  pendingHooks: string[];   // Array of active hookIds
}
```

When the orchestrator restarts via `ContinueAsNew`, it loads the user's session from Cosmos (via `loadStateActivity`). The session document includes the full `OverseerState` — including `pendingHooks[]`. The overseer re-registers waitForExternalEvent for each active hook type on restart.

```typescript
// In overseer.ts — after state load
for (const hookId of state.pendingHooks) {
  // Re-establish hook event listener for this hook
  context.df.waitForExternalEvent(`HookFired_${hookId}`);
}
```

### 2.5 External Event Wiring

```typescript
// filepath: src/functions/hookReceiver.ts (new HTTP trigger)

export async function hookReceiver(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponse> {
  const { hookId, payload, triggerType } = await req.json() as HookReceiverPayload;
  
  // Verify hook exists and is active
  const hook = await getHookById(hookId);
  if (!hook || hook.status !== 'active') {
    return { status: 404, body: 'Hook not found or inactive' };
  }
  
  // RaiseDurableEvent to resume the orchestrator
  context.df.raiseEvent(`HookFired_${hookId}`, {
    hookId,
    payload,
    triggerType,
    firedAt: new Date().toISOString(),
  });
  
  return { status: 202, body: 'Accepted' };
}
```

```typescript
// In overseer.ts — event wait pattern
const hookFired = yield context.df.waitForExternalEvent('HookFired');
// Parse hookFired payload, run verification pipeline, execute hook action
```

### 2.6 Emergency Stop Integration

When emergency stop is triggered (see ADDENDA-05), all active hooks for the user are set to `paused`:

```typescript
// filepath: src/bot/maintenanceMode.ts (emergency stop extension)

export async function pauseAllHooksForUser(userId: string): Promise<void> {
  const container = getContainer(CATALOG_CONTAINER);
  const { resources } = await container.items
    .query({
      query: 'SELECT * FROM c WHERE c.userId = @uid AND c.status = @active',
      parameters: [{ name: '@uid', value: userId }, { name: '@active', value: 'active' }],
    })
    .fetchAll();
  
  for (const hook of resources) {
    await container.item(hook.id, userId).patch({
      operations: [{ op: 'replace', path: '/status', value: 'paused' }],
    });
  }
}
```

---

## 3. DevLoop Relay — ide-messages Container

### 3.1 Purpose

The `ide-messages` container enables bidirectional communication between DevLoop (running in the user's IDE as a VS Code extension or MCP server) and the HelkinSwarm runtime (running in Azure). This is the relay channel for the DevLoop interrogation protocol.

The relay supports two patterns:
- **Push (DevLoop → Runtime):** DevLoop sends a DEVQUERY or DEVLOOP message; runtime processes it and responds
- **Pull (Runtime → DevLoop):** Runtime sends a HELKIN-REPLY or async notification; DevLoop polls or receives via webhook

### 3.2 Container Schema

```typescript
// filepath: src/memory/memoryManager.ts (container constant)
const IDE_MESSAGES_CONTAINER = 'ide-messages';

interface IdeMessageDocument {
  id: string;                     // UUID v4
  correlationId: string;          // cc-XXXXXXXX — threads to originating turn
  
  // Routing
  direction: 'inbound' | 'outbound';  // inbound = DevLoop→Runtime, outbound = Runtime→DevLoop
  sender: 'devloop' | 'runtime';   // Source of this message
  
  // Message
  messageType: 'DEVQUERY' | 'DEVLOOP' | 'HELKIN-REPLY' | 'ASYNC-NOTIFICATION' | 'HEARTBEAT';
  payload: Record<string, unknown>;  // Type-specific payload
  
  // Lifecycle
  timestamp: string;               // ISO 8601
  expiresAt: string;               // ISO 8601 — 7 days from timestamp
  status: 'pending' | 'delivered' | 'failed';
  
  // Delivery
  deliveredAt?: string;            // ISO 8601 — when DevLoop acknowledged
  deliveryAttempts: number;        // Incremented on retry
}
```

Partition key: `correlationId`  
TTL: 7 days (`7 * 24 * 60 * 60` seconds)

### 3.3 Push Pattern (DevLoop → Runtime)

```typescript
// DevLoop side: sends DEVQUERY to runtime via HTTP
// Runtime receives at src/functions/devLoopRelay.ts

export async function devLoopRelay(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponse> {
  const body = await req.json() as DevLoopMessage;
  
  // Persist to ide-messages
  const container = getContainer(IDE_MESSAGES_CONTAINER);
  const doc: IdeMessageDocument = {
    id: crypto.randomUUID(),
    correlationId: body.correlationId ?? `cc-${randomHex(8)}`,
    direction: 'inbound',
    sender: 'devloop',
    messageType: body.messageType,
    payload: body.payload,
    timestamp: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
    deliveryAttempts: 0,
  };
  
  await container.items.create(doc);
  
  // Raise durable event to wake the orchestrator
  context.df.raiseEvent('DevLoopMessage', {
    messageId: doc.id,
    correlationId: doc.correlationId,
  });
  
  return { status: 202, body: JSON.stringify({ messageId: doc.id }) };
}
```

### 3.4 Pull Pattern (Runtime → DevLoop)

```typescript
// DevLoop polls for outbound messages
// GET /api/tab/devloop/messages?since={timestamp}&limit=50

export async function devLoopPoll(
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponse> {
  const since = req.query.get('since') ?? new Date(Date.now() - 60 * 1000).toISOString();
  const limit = parseInt(req.query.get('limit') ?? '50', 10);
  
  const container = getContainer(IDE_MESSAGES_CONTAINER);
  const { resources } = await container.items
    .query({
      query: `SELECT * FROM c WHERE c.direction = 'outbound' AND c.timestamp > @since ORDER BY c.timestamp ASC`,
      parameters: [{ name: '@since', value: since }],
    })
    .fetchAll();
  
  // Mark as delivered
  for (const msg of resources.slice(0, limit)) {
    await container.item(msg.id, msg.correlationId).patch({
      operations: [
        { op: 'replace', path: '/status', value: 'delivered' },
        { op: 'replace', path: '/deliveredAt', value: new Date().toISOString() },
      ],
    });
  }
  
  return {
    status: 200,
    body: JSON.stringify({ messages: resources.slice(0, limit) }),
  };
}
```

---

## 4. Watchdog & Heartbeat Protocol

### 4.1 Session Resurrector

When the Durable Functions host restarts (container recycle, scale event), orchestrations that were mid-execution are automatically resumed by the Durable Functions fabric. However, any messages that arrived during the downtime must be recovered.

```typescript
// filepath: src/orchestrator/sessionResurrector.ts (new activity)

export interface SessionResurrectorInput {
  userId: string;
}

export interface SessionResurrectorResult {
  recoveredTurns: number;
  recoveredHooks: number;
  errors: string[];
}

/**
 * Called on Function App startup (see src/functions/index.ts startup handler).
 * Scans for any pending turns or hook events that arrived during downtime
 * and re-injects them into the orchestrator.
 */
export async function sessionResurrector(
  input: SessionResurrectorInput,
): Promise<SessionResurrectorResult> {
  const errors: string[] = [];
  
  // 1. Recover pending_intents (turns that arrived while offline)
  // See ADDENDA-05 / issue #116 for pending_intents schema
  const pendingContainer = getContainer('pending_intents');
  const { resources: pendingTurns } = await pendingContainer.items
    .query({
      query: 'SELECT * FROM c WHERE c.userId = @uid AND c.status IN ["received","failed"] ORDER BY c.timestamp ASC',
      parameters: [{ name: '@uid', value: input.userId }],
    })
    .fetchAll();
  
  // 2. Recover ide-messages that were 'pending' during downtime
  const ideContainer = getContainer(IDE_MESSAGES_CONTAINER);
  const { resources: pendingMessages } = await ideContainer.items
    .query({
      query: "SELECT * FROM c WHERE c.direction = 'inbound' AND c.status = 'pending' AND c.timestamp > @since",
      parameters: [{ name: '@since', value: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }],
    })
    .fetchAll();
  
  // 3. Re-raise events to orchestrator
  for (const turn of pendingTurns) {
    try {
      // Raise NewMessage event to the user's orchestrator
      // The orchestrator must be waiting for this via waitForExternalEvent
      const orchestratorId = `overseer-${input.userId}`;
      // Note: Raising events to a specific orchestration instance requires the instance ID
      // This is stored in the session document
      errors.push(`Turn recovery for ${turn.id} requires instance ID — deferred`);
    } catch (err) {
      errors.push(`Failed to recover turn ${turn.id}: ${err}`);
    }
  }
  
  return {
    recoveredTurns: pendingTurns.length,
    recoveredHooks: pendingMessages.length,
    errors,
  };
}
```

### 4.2 Heartbeat Protocol

Each orchestrator instance sends a heartbeat to Cosmos every 60 seconds while processing:

```typescript
// filepath: src/orchestrator/overseer.ts (inside orchestration handler)

let heartbeatInterval: NodeJS.Timeout | null = null;

try {
  // Start heartbeat
  heartbeatInterval = setInterval(async () => {
    await context.df.callActivity('heartbeatActivity', {
      userId: state.userId,
      orchestratorInstanceId: context.df.instanceId,
      timestamp: new Date().toISOString(),
    });
  }, 60_000);
  
  // ... main orchestration loop ...
  
} finally {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
}
```

```typescript
// filepath: src/orchestrator/heartbeatActivity.ts

export interface HeartbeatInput {
  userId: string;
  orchestratorInstanceId: string;
  timestamp: string;
}

export async function heartbeat(input: HeartbeatInput): Promise<void> {
  const container = getContainer('sessions');
  await container.item(input.userId, input.userId).patch({
    operations: [
      { op: 'replace', path: '/lastHeartbeatAt', value: input.timestamp },
      { op: 'replace', path: '/orchestratorInstanceId', value: input.orchestratorInstanceId },
    ],
  });
}
```

If App Insights shows no heartbeat for a user for > 5 minutes, the watchdog can trigger recovery.

---

## 5. App Insights Events

| Event Name | When | Key Properties |
|------------|------|----------------|
| `HookRegistered` | Hook saved to Cosmos | `hookId`, `hookType`, `skillDomain`, `riskLevel` |
| `HookFired` | External trigger received | `hookId`, `triggerType`, `correlationId` |
| `HookCompleted` | Hook action finished | `hookId`, `durationMs`, `success` |
| `HookExpired` | Hook reached `expiresAt` | `hookId` |
| `IdeMessageSent` | Message written to ide-messages | `messageId`, `direction`, `messageType`, `correlationId` |
| `IdeMessageDelivered` | DevLoop acknowledged | `messageId`, `deliveryLatencyMs` |
| `SessionResurrected` | Startup recovery run | `userId`, `recoveredTurns`, `recoveredHooks` |
| `HeartbeatMissed` | No heartbeat for > 5 min | `userId`, `lastHeartbeatAt` |

---

## 6. Acceptance Criteria

- [ ] `longRunningCatalog` container with `userId` partition key and full document schema
- [ ] `ide-messages` container with `correlationId` partition key and 7-day TTL
- [ ] Hook registration activity writes to `longRunningCatalog` with idempotency dedup
- [ ] Hook IDs survive `ContinueAsNew` via `state.pendingHooks[]`
- [ ] External events (`HookFired_{hookId}`) resume the orchestrator correctly
- [ ] Hook receiver HTTP endpoint (`/api/hook/receive`) raises durable events
- [ ] DevLoop relay HTTP endpoint (`/api/devloop/relay`) persists messages and raises events
- [ ] DevLoop poll endpoint (`/api/tab/devloop/messages`) returns and marks delivered
- [ ] `sessionResurrector` activity scans pending_intents + ide-messages on startup
- [ ] Heartbeat activity updates session document every 60 seconds
- [ ] Emergency stop pauses all hooks for a user
- [ ] All events logged to App Insights with `correlationId` dimension
- [ ] E2E test: create hook → simulate external trigger → verify orchestrator resumed
