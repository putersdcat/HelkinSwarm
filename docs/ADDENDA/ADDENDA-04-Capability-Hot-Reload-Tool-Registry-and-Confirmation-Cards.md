# HelkinSwarm Project Specification — Addendum Series

## ADDENDA-04. Capability Hot-Reload, Tool Registry & Human Confirmation Cards

**Version:** 1.0  
**Date:** March 2026  
**Status:** Implementation spec  
**References:** Doc `05` (Capabilities Framework), doc `0a` (Modularity), doc `0e` (Safety Pipeline)

---

## 1. Purpose

Doc `05` describes the capabilities framework and the Tool Registry at a high level. Doc `0e` describes the human confirmation Adaptive Card flow. This addendum specifies the exact implementation of three interconnected systems:

1. **Capability Loader with hot-reload** — scans `skills/*/manifest.json`, validates with Zod, and registers tools without restart
2. **Central Tool Registry** — OpenAI-compatible function schema registry with per-tool metadata
3. **Human Confirmation Cards** — the exact Adaptive Card format, timeout behavior, and orchestration wiring

---

## 2. Capability Loader with Hot-Reload

### 2.1 The CapabilityEntry Interface

```typescript
// filepath: src/capabilities/capabilitySchema.ts

import { z } from "zod";

const CapabilityToolSchema = z.object({
  name: z.string().regex(/^[a-z_]+_[a-z_]+$/, "must be domain_toolname"),
  description: z.string(),
  risk: z.enum(["low", "medium", "high"]),
  privilege: z.enum(["read-only", "delete-only", "read-write"]),
  dataSensitivity: z.enum(["pii", "non-pii", "mixed"]),
  allowedModelLane: z.enum(["any", "global", "eu-only"]).default("any"),
  requiresConfirmation: z.boolean().default(false),
  delegated: z.boolean().default(false),       // Can run as delegated (vs app-only)
  spotCheckRule: z.enum(["always", "threshold", "never"]).default("threshold"),
  spotCheckThreshold: z.number().default(10),  // Max items before sampling
  externalAutomationCapabilities: z.array(z.object({
    type: z.string(),
    description: z.string(),
    action: z.string(),
  })).default([]),
  longTermMemorySchema: z.array(z.string()).default([]),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
});

const CapabilityManifestSchema = z.object({
  domain: z.string(),
  version: z.string(),
  tools: z.array(CapabilityToolSchema),
});

export type CapabilityEntry = z.infer<typeof CapabilityToolSchema>;
export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
```

### 2.2 Capability Loader

```typescript
// filepath: src/capabilities/capabilityLoader.ts

import { readFile } from "fs/promises";
import { glob } from "glob";
import { CapabilityManifestSchema, type CapabilityEntry } from "./capabilitySchema.js";
import { toolRegistry } from "./toolRegistry.js";

let capabilityCache: Map<string, CapabilityEntry[]> = new Map();

export async function loadCapabilities(): Promise<void> {
  const manifestPaths = await glob("skills/*/manifest.json", { cwd: process.cwd() });

  const allEntries: CapabilityEntry[] = [];

  for (const manifestPath of manifestPaths) {
    const raw = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Validate with Zod — throws on failure
    const manifest = CapabilityManifestSchema.parse(parsed);

    // Validate each tool's outputSchema is valid JSON Schema
    for (const tool of manifest.tools) {
      validateOutputSchema(tool.name, tool.outputSchema);
    }

    capabilityCache.set(manifest.domain, manifest.tools);
    allEntries.push(...manifest.tools);

    console.log(`[capability-loader] Loaded ${manifest.tools.length} tools from ${manifest.domain}`);
  }

  // Rebuild tool registry
  toolRegistry.rebuild(allEntries);

  console.log(`[capability-loader] Total: ${allEntries.length} tools across ${manifestPaths.length} domains`);
}

export async function resetCapabilityRegistry(): Promise<void> {
  console.log("[capability-loader] Hot-reload: clearing cache and reloading...");
  capabilityCache.clear();
  await loadCapabilities();
}

export function getCapabilities(domain?: string): CapabilityEntry[] {
  if (domain) return capabilityCache.get(domain) ?? [];
  return Array.from(capabilityCache.values()).flat();
}

export function getCapability(toolName: string): CapabilityEntry | undefined {
  for (const entries of capabilityCache.values()) {
    const found = entries.find(t => t.name === toolName);
    if (found) return found;
  }
  return undefined;
}

function validateOutputSchema(toolName: string, schema: unknown): void {
  // Verify it's valid JSON Schema (basic validation)
  if (typeof schema !== "object" || schema === null) {
    throw new Error(`Invalid outputSchema for ${toolName}: must be an object`);
  }
  // Additional JSON Schema structural validation can be added here
}
```

Hot-reload now has one more derived artifact to keep consistent:

- the **manifest-derived skill discovery index**

On every successful load/reload, the runtime clears the previous discovery dataset and rebuilds it from the freshly validated manifests. This ensures future discovery-first routing work cannot keep serving stale tool/skill metadata after `/reload skills`, periodic reload, or SkillForge-driven manifest changes.

### 2.3 Hot-Reload Trigger

```typescript
// filepath: src/bot/HelkinSwarmBot.ts

// In onMessage handler, check for /reload command:
if (message.text.startsWith("/reload")) {
  await resetCapabilityRegistry();
  await context.sendActivity("Capabilities reloaded. Current tools: " +
    getCapabilities().map(t => t.name).join(", "));
  return;
}
```

Or via timer — reload every 5 minutes:

```typescript
// filepath: src/capabilities/capabilityLoader.ts

setInterval(async () => {
  try {
    await loadCapabilities();
  } catch (err) {
    console.error("[capability-loader] Periodic reload failed:", err);
  }
}, 5 * 60 * 1000);
```

---

## 3. Central Tool Registry

### 3.1 Registry Class

```typescript
// filepath: src/capabilities/toolRegistry.ts

import type { CapabilityEntry } from "./capabilitySchema.js";

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: {  // OpenAI function-calling format
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  risk: string;
  privilege: string;
  domain: string;
}

class ToolRegistry {
  private tools: Map<string, ToolDescriptor> = new Map();
  private domains: Set<string> = new Set();

  rebuild(entries: CapabilityEntry[]): void {
    this.tools.clear();
    this.domains.clear();

    for (const entry of entries) {
      const descriptor: ToolDescriptor = {
        name: entry.name,
        description: entry.description,
        parameters: {
          type: "object",
          properties: entry.inputSchema.properties ?? {},
          required: entry.inputSchema.required ?? [],
        },
        risk: entry.risk,
        privilege: entry.privilege,
        domain: entry.name.split("_")[0],  // First segment = domain
      };
      this.tools.set(entry.name, descriptor);
      this.domains.add(descriptor.domain);
    }
  }

  getTool(name: string): ToolDescriptor | undefined {
    return this.tools.get(name);
  }

  getToolsByDomain(domain: string): ToolDescriptor[] {
    return Array.from(this.tools.values()).filter(t => t.domain === domain);
  }

  getAllTools(): ToolDescriptor[] {
    return Array.from(this.tools.values());
  }

  getOpenAiFunctions(): object[] {
    return Array.from(this.tools.values()).map(t => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getDomains(): string[] {
    return Array.from(this.domains);
  }
}

export const toolRegistry = new ToolRegistry();
```

### 3.2 Filtering for Safety Mode

```typescript
// filepath: src/capabilities/toolRegistry.ts

export function getToolsForSafetyMode(safetyMode: SafetyMode): ToolDescriptor[] {
  const all = toolRegistry.getAllTools();

  if (safetyMode === "read-only") {
    return all.filter(t => t.privilege === "read-only");
  }

  // confirmation-gated and full-destructive show all, but high-risk requires confirmation at runtime
  return all;
}
```

---

## 4. Human Confirmation Cards

### 4.1 ConfirmationCard Interface

```typescript
// filepath: src/bot/humanConfirmation.ts

export interface ConfirmationCardData {
  toolName: string;
  action: string;           // "delete 7 emails", "close issue #42", etc.
  riskLevel: "medium" | "high";
  detail: string;           // Human-readable description of what will happen
  affectedItems?: string[]; // e.g., email subjects, issue titles
  timeoutMs: number;        // Default 5 minutes
  correlationId: string;
}

export interface ConfirmationResponse {
  approved: boolean;
  correlationId: string;
  respondedAt: string;
}
```

### 4.2 Card Rendering

```typescript
// filepath: src/bot/humanConfirmation.ts

import { AdaptiveCards } from "@microsoft/adaptivecards-tools";

export function renderConfirmationCard(data: ConfirmationCardData): object {
  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      {
        type: "Container",
        style: data.riskLevel === "high" ? "attention" : "accent",
        items: [
          {
            type: "TextBlock",
            size: "Medium",
            weight: "Bolder",
            text: `${data.riskLevel === "high" ? "⚠️ High-Risk Action" : "📋 Action Requires Confirmation"}`,
          },
          {
            type: "TextBlock",
            text: data.detail,
            wrap: true,
            spacing: "Medium",
          },
        ],
      },
      {
        type: "FactSet",
        facts: [
          { title: "Tool", value: data.toolName },
          { title: "Action", value: data.action },
          { title: "Correlation ID", value: data.correlationId },
        ],
      },
      ...(data.affectedItems?.length
        ? [{
            type: "TextBlock",
            text: "Affected items:",
            weight: "Bolder",
            spacing: "Medium",
          }, {
            type: "TextBlock",
            text: data.affectedItems.slice(0, 5).map(i => `• ${i}`).join("\n"),
            wrap: true,
            size: "Small",
          }]
        : []),
    ],
    actions: [
      {
        type: "Action.Execute",
        title: "Approve",
        verb: "confirm",
        style: data.riskLevel === "high" ? "positive" : "default",
      },
      {
        type: "Action.Execute",
        title: "Cancel",
        verb: "cancel",
        style: "destructive",
      },
    ],
    msteams: {
      width: "full",
    },
  };

  return card;
}
```

### 4.3 Sending and Waiting for Response

```typescript
// filepath: src/orchestrator/humanConfirmationActivity.ts

export df.app.activity("humanConfirmationActivity", async (
  context: OrchestrationContext,
  data: ConfirmationCardData
): Promise<ConfirmationResponse> => {
  // 1. Render card
  const card = renderConfirmationCard(data);

  // 2. Send via Teams proactive message
  const activityId = await context.sendActivity({
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }],
  });

  // 3. Wait for response (external event with timeout)
  const timeoutMs = data.timeoutMs ?? 5 * 60 * 1000;

  const response = await context.waitForExternalEvent("ConfirmationResponse", timeoutMs);

  if (!response) {
    // Timeout
    return {
      approved: false,
      correlationId: data.correlationId,
      respondedAt: new Date().toISOString(),
    };
  }

  return {
    approved: response.approved,
    correlationId: data.correlationId,
    respondedAt: new Date().toISOString(),
  };
});
```

### 4.4 Bot Layer Response Handling

```typescript
// filepath: src/bot/HelkinSwarmBot.ts

// Handle Adaptive Card button clicks:
if (message.channelId === "msteams" && message.value?.verb === "confirm") {
  const correlationId = message.value.correlationId;
  df.client.raiseEvent(correlationId, "ConfirmationResponse", { approved: true });
  return;
}

if (message.channelId === "msteams" && message.value?.verb === "cancel") {
  const correlationId = message.value.correlationId;
  df.client.raiseEvent(correlationId, "ConfirmationResponse", { approved: false });
  return;
}
```

---

## 5. Wiring Confirmation into the Orchestrator

```typescript
// filepath: src/orchestrator/sessionOrchestrator.ts

// In the tool dispatch section, after verification pipeline:
if (result.passed && capability.risk === "high" && capability.requiresConfirmation) {
  const confirmResult = yield context.callActivity("humanConfirmationActivity", {
    toolName: capability.name,
    action: describeAction(capability, args),
    riskLevel: "high",
    detail: `This will ${describeAction(capability, args)}. Are you sure?`,
    affectedItems: extractAffectedItemSummaries(result.verified),
    timeoutMs: 5 * 60 * 1000,
    correlationId: input.correlationId,
  });

  if (!confirmResult.approved) {
    return { reply: "Action cancelled by user.", cancelled: true };
  }
}
```

---

## 6. Acknowledgment Variants

### 6.1 The Problem

Repeatedly sending "Working on it..." is jarring and reveals the internal processing state.

### 6.2 Solution: Rotating Variants + Braille Spinner

```typescript
// filepath: src/bot/ackVariants.ts

const ACK_VARIANTS = [
  "Working on it...",
  "Processing...",
  "Just a moment...",
  "On it...",
  "Let me check...",
  "Looking into that...",
  "Hold on...",
  "Handling it...",
  "Right away...",
  "Sorting it out...",
];

let ackIndex = 0;

export function pickAckVariant(): string {
  const variant = ACK_VARIANTS[ackIndex % ACK_VARIANTS.length];
  ackIndex++;
  return variant;
}

// Braille spinner frames for in-place updates
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let spinnerFrame = 0;

export function nextSpinnerFrame(): string {
  const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
  spinnerFrame++;
  return frame;
}

// Heartbeat activity updates the ack with spinner frames during long operations
export async function heartbeatActivity(context: OrchestrationContext, ackActivityId: string): Promise<void> {
  while (true) {
    await delay(3000);  // 3 second interval
    const frame = nextSpinnerFrame();
    await context.updateActivity(ackActivityId, {
      text: `${frame} Still working...`,
    });
  }
}
```

---

## 7. Key Files

| File | Action | Notes |
|------|--------|-------|
| `src/capabilities/capabilitySchema.ts` | **Create** | Zod schemas for capability manifests |
| `src/capabilities/capabilityLoader.ts` | **Create** | Hot-reload capability loader |
| `src/capabilities/toolRegistry.ts` | **Create** | Central tool registry |
| `src/bot/humanConfirmation.ts` | **Create** | Confirmation card rendering |
| `src/orchestrator/humanConfirmationActivity.ts` | **Create** | Wait-for-confirmation activity |
| `src/bot/ackVariants.ts` | **Create** | Rotating ack variants + spinner |
| `src/bot/HelkinSwarmBot.ts` | **Modify** | Wire Adaptive Card button handling |

---

## 8. Acceptance Criteria

1. `loadCapabilities()` successfully loads all `skills/*/manifest.json` files and validates with Zod
2. `resetCapabilityRegistry()` clears cache and rebuilds — callable at runtime without restart
3. Tool Registry exposes OpenAI-compatible `getOpenAiFunctions()` for the LLM layer
4. `/reload` command in Teams chat triggers hot-reload and confirms via Teams message
5. High-risk actions produce a correct Adaptive Card with Approve/Cancel buttons
6. Card button clicks raise the correct Durable external event back to the orchestrator
7. Timeout on confirmation returns `approved: false` and notifies user
8. Ack variants rotate through all 10 messages without immediate repetition
9. Braille spinner updates the ack message every 3 seconds during long operations
