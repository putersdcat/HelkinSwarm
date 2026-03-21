# HelkinSwarm Project Specification — Addendum Series

## ADDENDA-01. Turn Telemetry & Correlation ID System

**Version:** 1.0  
**Date:** March 2026  
**Status:** Core implementation spec — filling gap between doc 0n (design) and current codebase  
**Replaces / Implements:** `docs/0n-Turn-by-Turn-Debug-Telemetry.md` at the implementation level

---

## 1. Purpose

This addendum specifies the exact implementation of the turn telemetry and correlation ID system. Document `0n` describes the *vision* for in-band debug telemetry appended to responses. This addendum specifies the *exact mechanisms* needed to build it: the correlation ID format, all injection points through the orchestrator, the telemetry data structure, the append format, and the App Insights event schema.

This is a prerequisite for meaningful debugging, DevLoop interrogation (`0g`), and the Dev Console tab.

---

## 2. Correlation ID System

### 2.1 Format

```
cc-{8-char-hex}
```

Example: `cc-a3f7192e`

- Generated once at message ingress in `HelkinSwarmBot.onMessage()`  
- 8 hex characters = 32 bits of entropy — sufficient for uniqueness within a 24-hour window  
- Lowercase to match existing conventions  
- The `cc` prefix identifies it as a **conversation correlation** ID (distinguishes from other ID types like session or trace IDs)

### 2.2 Generation

```typescript
// filepath: src/bot/HelkinSwarmBot.ts
function generateCorrelationId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return "cc-" + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
```

### 2.3 Threading Contract

The correlation ID is the single most important observability artifact. It must be threaded through **every** operation without exception:

```
Bot message ingress
  └─→ generateCorrelationId() → cc-XXXXXXXX
        ├─→ startOrchestration("overseer", { correlationId, ... })
        │     ├─→ llmActivity(correlationId)
        │     │     ├─→ App Insights event: "LLMCall" { correlationId, ... }
        │     │     └─→ emitModelCallCompliance({ correlationId, ... })  ← EU compliance
        │     │
        │     ├─→ toolDispatchActivity(correlationId, toolName, args)
        │     │     ├─→ subAgentActivity / executorActivity
        │     │     │     ├─→ App Insights event: "ToolExecuted" { correlationId, toolName, ... }
        │     │     │     └─→ verificationPipeline(correlationId)
        │     │     │           ├─→ App Insights event: "VerificationStep" { correlationId, step, result }
        │     │     │           └─→ ...
        │     │
        │     ├─→ sendReplyActivity(correlationId, reply)
        │     │     └─→ App Insights event: "ReplySent" { correlationId, ... }
        │     │
        │     ├─→ memoryManager.saveMemory(correlationId, ...)?
        │     │     └─→ App Insights event: "MemoryWrite" { correlationId, ... }
        │     │
        │     └─→ turnTelemetry.record(correlationId, events)
        │           └─→ App Insights event: "TurnCompleted" { correlationId, totalMs, ... }
        │
        └─→ ackActivityId stored alongside correlationId for update-in-place
```

### 2.4 Correlation ID in App Insights

Every App Insights event must include `correlationId` as a custom dimension:

```typescript
telemetryClient.trackEvent({
  name: "ToolExecuted",
  properties: {
    correlationId,
    toolName,
    skillDomain,
    riskLevel,
    durationMs,
    success,
  }
});
```

This enables KQL queries like:
```
AppTraces
| where tostring(customDimensions.correlationId) == "cc-a3f7192e"
| order by timestamp asc
```

---

## 3. Turn Telemetry Data Structure

### 3.1 TelemetryEvent Interface

```typescript
// filepath: src/orchestrator/turnTelemetry.ts

export interface TelemetryEvent {
  phase: TelemetryPhase;
  label?: string;
  startedAt: number;      // performance.now() at start
  endedAt?: number;       // set when complete
  durationMs?: number;     // endedAt - startedAt
  metadata?: Record<string, unknown>;
}

export type TelemetryPhase =
  | "ingress"           // Message received by bot
  | "prompt_build"      // Building prompt (skill memory injection, Hydra-Net)
  | "llm_call"          // LLM activity
  | "verification"      // Each verification step
  | "tool_dispatch"     // Tool call execution
  | "memory_write"      // Memory save
  | "reply_send"        // Final reply sent
  | "continue_as_new";   // Summarization + context rollover
```

### 3.2 TurnTelemetry Class

```typescript
// filepath: src/orchestrator/turnTelemetry.ts

export class TurnTelemetry {
  private events: TelemetryEvent[] = [];
  private correlationId: string;
  private turnStartTime: number;

  constructor(correlationId: string) {
    this.correlationId = correlationId;
    this.turnStartTime = performance.now();
  }

  start(phase: TelemetryPhase, label?: string): void {
    this.events.push({
      phase,
      label,
      startedAt: performance.now(),
    });
  }

  end(phase: TelemetryPhase, metadata?: Record<string, unknown>): void {
    const event = this.findOpen(phase);
    if (!event) return;
    event.endedAt = performance.now();
    event.durationMs = event.endedAt - event.startedAt;
    event.metadata = metadata;
  }

  private findOpen(phase: TelemetryPhase): TelemetryEvent | undefined {
    // Find last open event matching phase
    return [...this.events].reverse().find(e => e.phase === phase && !e.endedAt);
  }

  formatFooter(): string {
    // Build the terse telemetry string appended to replies
    const totalMs = performance.now() - this.turnStartTime;
    const parts: string[] = [];

    const byPhase = (phase: TelemetryPhase) =>
      this.events.filter(e => e.phase === phase && e.durationMs !== undefined);

    const llm = byPhase("llm_call");
    const tools = byPhase("tool_dispatch");
    const verification = byPhase("verification");
    const memory = byPhase("memory_write");

    // Format: [Total:5.2s|Sub1:ToolA:120ms|ToolB:450ms|MemInject:80ms|HookReg:200ms]
    parts.push(`Total:${fmtMs(totalMs)}`);

    if (llm.length > 0) {
      const llmMs = llm.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
      parts.push(`LLM:${fmtMs(llmMs)}`);
    }

    if (tools.length > 0) {
      const toolLabels = tools.map(e => `${e.label ?? "unk"}:${fmtMs(e.durationMs ?? 0)}`).join("|");
      parts.push(`Tools:${toolLabels}`);
    }

    if (verification.length > 0) {
      const vMs = verification.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
      parts.push(`Verify:${fmtMs(vMs)}`);
    }

    if (memory.length > 0) {
      parts.push(`Mem:${fmtMs(memory.reduce((sum, e) => sum + (e.durationMs ?? 0), 0))}`);
    }

    return `[${parts.join("|")}] [Corr:${this.correlationId}]`;
  }

  toAppInsightsEvents(): Record<string, unknown>[] {
    return this.events.map(e => ({
      name: "TurnTelemetryEvent",
      correlationId: this.correlationId,
      phase: e.phase,
      label: e.label,
      durationMs: e.durationMs,
      metadata: e.metadata,
    }));
  }
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}
```

---

## 4. Injection Points in the Orchestrator

### 4.1 In the Session Orchestrator

```typescript
// filepath: src/orchestrator/sessionOrchestrator.ts

export df.app.orchestration("sessionOrchestrator", async function* (context, input: SessionInput) {
  const telemetry = new TurnTelemetry(input.correlationId);
  telemetry.start("ingress");

  try {
    // Load session context
    telemetry.start("prompt_build");
    const sessionContext = yield context.callActivity("loadSessionContext", { ... });
    telemetry.end("prompt_build", { hasSummary: !!sessionContext.summary });

    // Build prompt
    telemetry.start("prompt_build", "build");
    const messages = yield context.callActivity("buildPromptActivity", { ... });
    telemetry.end("prompt_build");

    // LLM call
    telemetry.start("llm_call");
    const llmResult = yield context.callActivity("llmActivity", {
      messages,
      useTools: true,
      correlationId: input.correlationId,
    });
    telemetry.end("llm_call", {
      model: llmResult.model,
      promptTokens: llmResult.promptTokens,
      completionTokens: llmResult.completionTokens,
      toolCalls: llmResult.toolCalls?.length ?? 0,
    });

    // Tool dispatch
    if (llmResult.toolCalls?.length) {
      for (const tc of llmResult.toolCalls) {
        telemetry.start("tool_dispatch", tc.name);
        const toolResult = yield context.callActivity("toolDispatchActivity", {
          qualifiedToolName: tc.name,
          args: tc.arguments,
          correlationId: input.correlationId,
        });
        telemetry.end("tool_dispatch");
      }
    }

    // Reply
    telemetry.start("reply_send");
    yield context.callActivity("sendReplyActivity", {
      reply: finalReply,
      telemetryFooter: telemetry.formatFooter(),  // Append telemetry
    });
    telemetry.end("reply_send");

    telemetry.start("continue_as_new");
    return { reply: finalReply, telemetry: telemetry.toAppInsightsEvents() };

  } finally {
    // Always emit telemetry events on completion or failure
    for (const event of telemetry.toAppInsightsEvents()) {
      telemetryClient.trackEvent(event);
    }
  }
});
```

---

## 5. Telemetry Append Format

### 5.1 Format Specification

The telemetry footer is appended to the final reply text (outside the LLM tokenized response, at the application layer in `sendReplyActivity`):

```
[Total:5.2s|LLM:1.1s|Tools:email:890ms|Verify:210ms] [Corr:cc-a3f7192e]
```

### 5.2 Formatting Rules

| Phase | Format | Notes |
|-------|--------|-------|
| `Total` | Always present | Wall-clock time from turn start to reply |
| `LLM` | Present if LLM was called | Includes prompt + completion |
| `Tools` | Present if tools were called | `toolName:ms` pairs, pipe-separated, max 3 shown |
| `Verify` | Present if verification ran | Total time in verification pipeline |
| `Mem` | Present if memory was written | Save + index time |
| `Corr` | Always present, last | Correlation ID |

All times use `performance.now()` for sub-millisecond precision.

### 5.3 Feature Flag

```typescript
const DEV_TELEMETRY_MODE = process.env.DEV_TELEMETRY_MODE ?? "off";
// "off" | "minimal" | "standard" | "verbose"

// In sendReplyActivity:
if (DEV_TELEMETRY_MODE !== "off" && telemetryFooter) {
  reply = reply + "\n\n" + telemetryFooter;
}
```

- `minimal` → `[Total:5.2s] [Corr:cc-a3f7192e]`
- `standard` → `[Total:5.2s|LLM:1.1s] [Corr:cc-a3f7192e]`
- `verbose` → Full format as shown above

---

## 6. App Insights Event Schema

### 6.1 Core Events

| Event Name | When | Key Properties |
|------------|------|---------------|
| `TurnStarted` | Message received | `correlationId`, `userId`, `conversationId` |
| `LLMCall` | LLM activity called | `correlationId`, `model`, `promptTokens`, `completionTokens`, `durationMs`, `lane` |
| `ToolExecuted` | Tool dispatch | `correlationId`, `toolName`, `skillDomain`, `riskLevel`, `durationMs`, `success` |
| `VerificationStep` | Each verification step | `correlationId`, `step`, `toolName`, `passed`, `durationMs` |
| `HumanConfirmationRequested` | Card sent to user | `correlationId`, `toolName`, `riskLevel` |
| `HumanConfirmationReceived` | User responds | `correlationId`, `response: "approve" \| "cancel" \| "timeout"` |
| `MemoryWrite` | Memory saved | `correlationId`, `skillDomain`, `documentCount`, `durationMs` |
| `ReplySent` | Final reply delivered | `correlationId`, `hasTelemetryFooter`, `totalMs` |
| `TurnCompleted` | Turn finished | `correlationId`, `totalMs`, `toolCallCount`, `hadError` |

### 6.2 Example KQL Query

```kql
AppTraces
| where name == "ToolExecuted"
| where todynamic(customDimensions).correlationId == "cc-a3f7192e"
| order by timestamp asc
| project timestamp, tostring(customDimensions.toolName), tostring(customDimensions.durationMs)
```

---

## 7. Key Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/orchestrator/turnTelemetry.ts` | **Create** | `TurnTelemetry` class |
| `src/bot/HelkinSwarmBot.ts` | **Modify** | Add `generateCorrelationId()` call |
| `src/orchestrator/sessionOrchestrator.ts` | **Modify** | Inject `TurnTelemetry` into every activity call |
| `src/orchestrator/llmActivity.ts` | **Modify** | Accept `correlationId`, emit `LLMCall` event |
| `src/orchestrator/toolDispatchActivity.ts` | **Modify** | Accept `correlationId`, emit `ToolExecuted` |
| `src/orchestrator/sendReplyActivity.ts` | **Modify** | Append `formatFooter()` if flag enabled |
| `src/orchestrator/verificationPipeline.ts` | **Modify** | Accept `correlationId`, emit `VerificationStep` events |
| `src/orchestrator/humanConfirmation.ts` | **Modify** | Emit `HumanConfirmationRequested/Received` |

---

## 8. Dependencies

- Requires App Insights SDK (`applicationinsights`) — already in `package.json`
- Requires `performance.now()` — native, no dependency
- Requires `crypto.getRandomValues()` — native, no dependency
- No new external packages

---

## 9. Not in Scope (Per This Addendum)

- The Dev Console tab UI for viewing telemetry — handled by `ADDENDA-03` (Dev Console + Tab Infrastructure)
- The DevLoop relay querying of telemetry — handled by `0g`
- EU compliance event emission — handled by `ADDENDA-05` (Scoped Token Minter + Safety Pipeline)

---

## 10. Acceptance Criteria

1. Every turn produces a correlation ID that appears in every App Insights event for that turn
2. Telemetry footer appends to reply when `DEV_TELEMETRY_MODE` is not `"off"`
3. All 8 event types fire at the correct points
4. KQL query by correlation ID returns complete ordered trace of the turn
5. No PII in any telemetry event
6. `DEV_TELEMETRY_MODE=verbose` shows all phases; `minimal` shows only Total + Corr
