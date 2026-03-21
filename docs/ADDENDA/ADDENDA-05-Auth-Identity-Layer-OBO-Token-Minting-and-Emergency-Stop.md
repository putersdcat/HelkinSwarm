# HelkinSwarm Project Specification — Addendum Series

## ADDENDA-05. Auth Identity Layer — OBO Token Minting, Emergency Stop & Maintenance Mode

**Version:** 1.0  
**Date:** March 2026  
**Status:** Implementation spec  
**References:** Doc `11` (Authentication Identity), doc `04` (Safety Architecture)

---

## 1. Purpose

Doc `11` describes the authentication and identity architecture at a high level. This addendum specifies the exact implementation of the token minting chain (UAMI → OBO → scoped tokens), the emergency stop and maintenance mode system, and the conversation store for proactive messaging.

---

## 2. Token Minting Chain

### 2.1 Overview

```
User-Assigned Managed Identity (UAMI)
    │
    ├─→ OBO Flow (On-Behalf-Of) ──────────────────┐
    │     Certificate-based auth                    │
    │     Per-user token cache in Cosmos           │ (For Graph API calls on behalf of user)
    └─────────────────────────────────────────────┘
              │
              ▼
    Scoped Token Minter
    ├─ read-only scope set
    ├─ delete-only scope set
    └─ 5-minute TTL cap
              │
              ▼
    Tool Handler (skills/*)
```

### 2.2 Identity Service

```typescript
// filepath: src/auth/identity.ts

import { ManagedIdentityCredential } from "@azure/identity";

let identityInstance: ManagedIdentityCredential | null = null;

export function getIdentity(): ManagedIdentityCredential {
  if (!identityInstance) {
    const clientId = process.env.AZURE_CLIENT_ID;
    if (!clientId) throw new Error("AZURE_CLIENT_ID not set");

    identityInstance = new ManagedIdentityCredential({ clientId });
  }
  return identityInstance;
}

export async function getToken(scopes: string[]): Promise<string> {
  const identity = getIdentity();
  const result = await identity.getToken(scopes);
  return result.token;
}

// Detect MSI type from environment
export function getMsiType(): "userassignedmsi" | "systemassignedmsi" | "none" {
  const appType = process.env.MICROSOFT_APP_TYPE;
  if (appType === "userassignedmsi") return "userassignedmsi";
  if (appType === "systemassignedmsi") return "systemassignedmsi";
  return "none";
}
```

### 2.3 OBO Token Provider

The OBO (On-Behalf-Of) flow is used when HelkinSwarm needs to call Graph APIs *as the user* (e.g., reading their emails, calendar, Teams chats):

```typescript
// filepath: src/auth/oboTokenProvider.ts

import { ConfidentialClientApplication } from "@azure/msal-node";
import { readFile } from "fs/promises";

let ccaInstance: ConfidentialClientApplication | null = null;

async function getConfidentialClientApp(): Promise<ConfidentialClientApplication> {
  if (ccaInstance) return ccaInstance;

  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_APP_ID;
  const certThumbprint = process.env.OBO_CERTIFICATE_THUMBPRINT;
  const keyVaultUrl = process.env.KEY_VAULT_URL ?? "https://kv-helkinswarm.vault.azure.net";

  // Load certificate from Key Vault
  const cert = await getKeyVaultSecret(keyVaultUrl, certThumbprint!);

  ccaInstance = new ConfidentialClientApplication({
    auth: {
      clientId: clientId!,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientCertificate: {
        thumbprint: certThumbprint,
        privateKey: cert.cer ?? cert.key,
        x5cName: cert.name,
      },
    },
  });

  return ccaInstance;
}

export async function getOboToken(
  userUpn: string,
  scopes: string[]
): Promise<string> {
  const cca = await getConfidentialClientApp();

  // Check per-user cache in Cosmos first
  const cached = await loadCachedOboToken(userUpn, scopes);
  if (cached && !isTokenExpired(cached)) {
    return cached.accessToken;
  }

  // OBO flow: exchange cached initiator token for user-scoped token
  const result = await cca.acquireTokenOnBehalfOf({
    authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}`,
    oboAssertion: cached?.initiatorToken ?? (await getIdentity().getToken(["https://graph.microsoft.com/.default"])),
    scopes,
    tokenQueryParameters: { user_upn: userUpn },
  });

  // Cache in Cosmos
  await saveCachedOboToken(userUpn, scopes, result);

  return result.accessToken;
}
```

### 2.4 MSAL Token Cache Plugin (Per-User Cache)

```typescript
// filepath: src/auth/msalCachePlugin.ts

import { ICachePlugin, ITokenCache } from "@azure/msal-node";
import { cosmosClient } from "../memory/cosmosClient.js";

// Stores MSAL token cache in Cosmos DB per user
export class CosmosMsalCachePlugin implements ICachePlugin {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async afterCacheAccess(tokenCache: ITokenCache): Promise<void> {
    if (tokenCache.hasStateChanged) {
      const cacheBytes = await tokenCache.serialize();
      await cosmosClient.saveMsalCache(this.userId, Buffer.from(cacheBytes).toString("base64"));
      await tokenCache.clear();  // Don't hold in memory
    }
  }

  async beforeCacheAccess(tokenCache: ITokenCache): Promise<void> {
    const cached = await cosmosClient.loadMsalCache(this.userId);
    if (cached) {
      await tokenCache.deserialize(Buffer.from(cached, "base64").toString("utf-8"));
    }
  }
}

// For /revoke endpoint — purge all cached tokens
export async function purgeMsalCache(userId: string): Promise<void> {
  await cosmosClient.deleteMsalCache(userId);
}
```

---

## 3. Emergency Stop System

### 3.1 Design

Emergency stop must:
1. Be callable via HTTP API (protected)
2. Persist the stop state in Cosmos DB so it survives restarts
3. Immediately terminate all running orchestrations
4. Reply "I'm offline" to any new messages during the stop
5. Be reversible only by the owner

### 3.2 Emergency Stop State Document

```typescript
// filepath: src/bot/maintenanceMode.ts

interface EmergencyStopState {
  id: "emergency-stop-state";       // Singleton document
  userId: "system";
  isStopped: boolean;
  stoppedAt?: string;               // ISO timestamp
  stoppedBy?: string;              // AAD object ID
  reason?: string;
}

const AUTHORIZED_USERS = (process.env.EMERGENCY_STOP_AUTHORIZED_USERS ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
```

### 3.3 Emergency Stop API

```typescript
// filepath: src/functions/emergencyStop.ts

export async function emergencyStop(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponse> {
  // Verify caller is authorized
  const callerAadId = req.headers.get("x-ms-client-principal-id");
  if (!AUTHORIZED_USERS.includes(callerAadId)) {
    return { status: 403, body: "Forbidden" };
  }

  // Read body for optional reason
  let reason = "Manual emergency stop";
  if (req.body?.reason) reason = req.body.reason;

  // Save state to Cosmos
  const state: EmergencyStopState = {
    id: "emergency-stop-state",
    userId: "system",
    isStopped: true,
    stoppedAt: new Date().toISOString(),
    stoppedBy: callerAadId,
    reason,
  };
  await cosmosClient.saveEmergencyStopState(state);

  // Terminate all running orchestrations
  const runningInstances = await df.client.listInstances({
    hours: 1,
    showHistory: false,
  });
  for (const instance of runningInstances) {
    if (instance.runtimeStatus === "Running") {
      await df.client.terminate(instance.instanceId, { reason: "Emergency stop" });
    }
  }

  console.log(JSON.stringify({
    type: "emergency_stop_triggered",
    stoppedBy: callerAadId,
    reason,
    orchestrationsTerminated: runningInstances.filter(i => i.runtimeStatus === "Running").length,
    timestamp: new Date().toISOString(),
  }));

  return { status: 200, body: { success: true, message: "Emergency stop activated" } };
}

export async function emergencyResume(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponse> {
  const callerAadId = req.headers.get("x-ms-client-principal-id");
  if (!AUTHORIZED_USERS.includes(callerAadId)) {
    return { status: 403, body: "Forbidden" };
  }

  await cosmosClient.clearEmergencyStopState();

  return { status: 200, body: { success: true, message: "Emergency stop cleared" } };
}
```

### 3.4 Bot Layer Stop Check

```typescript
// filepath: src/bot/HelkinSwarmBot.ts

export async function onMessage(turnContext: TurnContext): Promise<void> {
  // Check emergency stop before anything else
  const stopState = await cosmosClient.getEmergencyStopState();
  if (stopState?.isStopped) {
    await turnContext.sendActivity(
      "🛑 HelkinSwarm is currently offline (emergency stop active). " +
      `Reason: ${stopState.reason ?? "unknown"}. ` +
      "Contact your administrator to resume."
    );
    return;
  }

  // Check maintenance mode (separate, less severe)
  const maintenanceMode = await cosmosClient.getMaintenanceMode();
  if (maintenanceMode?.isEnabled) {
    // Allow only specific commands in maintenance mode
    if (!isMaintenanceExempt(message.text)) {
      await turnContext.sendActivity(
        `🔧 HelkinSwarm is in maintenance mode. ${maintenanceMode.message ?? "Please try again later."}`
      );
      return;
    }
  }

  // Normal message processing continues...
}
```

---

## 4. Maintenance Mode (Less Severe)

Maintenance mode is less severe than emergency stop — it blocks normal traffic but allows specific commands through:

### 4.1 States

| State | Behavior |
|-------|----------|
| `off` | Normal operation |
| `draining` | Accepting current turns, rejecting new ones |
| `on` | Rejecting all messages except owner |
| `read-only` | Only read operations allowed |

```typescript
// filepath: src/bot/maintenanceMode.ts

interface MaintenanceState {
  id: string;              // "maintenance-state"
  mode: "off" | "draining" | "on" | "read-only";
  message?: string;        // Custom message shown to users
  enabledAt?: string;
  enabledBy?: string;
}

const MAINTAINENCE_EXEMPT_COMMANDS = [
  "/emergency-stop",
  "/emergency-resume",
  "/status",
  "/health",
];
```

### 4.2 API

```typescript
// POST /api/maintenance
export async function setMaintenanceMode(req, context): Promise<HttpResponse> {
  const callerAadId = req.headers.get("x-ms-client-principal-id");
  if (!AUTHORIZED_USERS.includes(callerAadId)) return { status: 403 };

  const { mode, message } = req.body;
  await cosmosClient.saveMaintenanceState({
    id: "maintenance-state",
    mode,
    message,
    enabledAt: new Date().toISOString(),
    enabledBy: callerAadId,
  });

  // Return 503 for normal traffic if mode is "on"
  return {
    status: mode === "on" ? 503 : 200,
    headers: mode === "on" ? { "Retry-After": "60" } : {},
    body: { success: true },
  };
}
```

---

## 5. Conversation Store (Proactive Messaging)

### 5.1 Purpose

The conversation store persists `ConversationReference` objects so HelkinSwarm can send proactive messages to users — startup/shutdown notices, durable hook callbacks, etc.

### 5.2 Interface

```typescript
// filepath: src/bot/conversationStore.ts

interface ConversationRefDocument {
  id: string;             // "conv-ref-{conversationId}"
  partitionKey: string;   // userId
  conversationId: string;
  reference: Record<string, unknown>;  // Bot Framework ConversationReference
  updatedAt: string;
  updatedBy: string;      // AAD object ID
}

export async function saveConversationReference(
  context: TurnContext
): Promise<void> {
  const ref = TurnContext.getConversationReference(context.activity);
  await cosmosClient.saveConversationRef(
    ref.conversation.user.id,   // partition key = userId
    ref.conversation.id,        // conversationId
    ref as unknown as Record<string, unknown>
  );
}

export async function loadConversationReference(
  userId: string,
  conversationId: string
): Promise<ConversationReference | undefined> {
  const doc = await cosmosClient.loadConversationRef(userId, conversationId);
  return doc?.reference as ConversationReference | undefined;
}
```

### 5.3 Lifecycle Notices

```typescript
// filepath: src/bot/lifecycleNotices.ts

export async function sendStartupNotice(): Promise<void> {
  const ref = await loadConversationReference(OWNER_USER_ID, OWNER_CONVERSATION_ID);
  if (!ref) return;

  await adapter.continueConversation(ref, async (ctx) => {
    await ctx.sendActivity(
      `🚀 **HelkinSwarm Online**\n\n` +
      `Version: ${process.env.HELKINSWARM_VERSION ?? "unknown"}\n` +
      `Started at: ${new Date().toISOString()}\n\n` +
      `Ready to assist.`
    );
  });
}

// Startup delay — delay message processing for 3s to allow container init
setTimeout(() => {
  console.log("[lifecycle] Startup delay complete");
  isReady = true;
}, 3000);

// SIGTERM handler
process.on("SIGTERM", async () => {
  await sendShutdownNotice("SIGTERM received");
  process.exit(0);
});
```

---

## 6. Cosmos DB Schema

### 6.1 Containers

```typescript
// filepath: src/memory/cosmosClient.ts

const COSMOS_CONTAINERS = {
  sessions: { id: "sessions", partitionKey: "userId" },
  userProfiles: { id: "userProfiles", partitionKey: "userId" },
  memories: { id: "memories", partitionKey: "userId" },
  skillMemory: { id: "skillMemory", partitionKey: "userId" },
  durableHooks: { id: "durableHooks", partitionKey: "userId" },
  conversationRefs: { id: "conversationRefs", partitionKey: "userId" },
  msalCache: { id: "msalCache", partitionKey: "userId" },
  config: { id: "config", partitionKey: "id" },
};
```

| Container | Partition Key | Purpose |
|-----------|---------------|---------|
| `sessions` | `userId` | Conversation history + summaries |
| `userProfiles` | `userId` | User preferences, safety overrides |
| `memories` | `userId` | General long-term memories |
| `skillMemory` | `userId` | Skill-specific vaults (with `skillId` in document) |
| `durableHooks` | `userId` | Long-running workflow state |
| `conversationRefs` | `userId` | Proactive messaging references |
| `msalCache` | `userId` | Per-user MSAL OAuth token cache |
| `config` | `id` | Global config (emergency stop state, maintenance mode) |

---

## 7. Key Files

| File | Action | Notes |
|------|--------|-------|
| `src/auth/identity.ts` | **Create** | UAMI singleton + MSI type detection |
| `src/auth/oboTokenProvider.ts` | **Create** | Certificate-based OBO + per-user cache |
| `src/auth/msalCachePlugin.ts` | **Create** | ICachePlugin for Cosmos-backed MSAL cache |
| `src/bot/maintenanceMode.ts` | **Create** | Emergency stop + maintenance mode state |
| `src/bot/conversationStore.ts` | **Create** | ConversationReference persistence |
| `src/bot/lifecycleNotices.ts` | **Create** | Startup/shutdown notices + SIGTERM handler |
| `src/functions/emergencyStop.ts` | **Create** | HTTP endpoints for e-stop |
| `src/memory/cosmosClient.ts` | **Modify** | Add all container definitions + emergency stop/mode methods |

---

## 8. Acceptance Criteria

1. UAMI token retrieval works in Container Apps (no DefaultAzureCredential chain needed)
2. OBO token is cached per-user in Cosmos and reused within its validity window
3. Emergency stop persists in Cosmos — survives container restart
4. Emergency stop immediately terminates all running orchestrations
5. During emergency stop, new messages receive the offline response
6. Maintenance mode returns 503 with `Retry-After` header
7. Maintenance mode allows exempt commands through (owner commands)
8. ConversationReference is saved on every incoming message
9. Proactive messages can be sent via `adapter.continueConversation()`
10. Startup notice is sent within 5 seconds of container ready
11. SIGTERM triggers graceful shutdown notice before process.exit
