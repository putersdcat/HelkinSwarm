# HelkinSwarm Project Specification — Addendum Series

## ADDENDA-02. Sub-Agent / Executor Pattern & Privilege Separation

**Version:** 1.0  
**Date:** March 2026  
**Status:** Core implementation spec — filling gap between docs `04` (safety architecture) and `0e` (verification pipeline) and current codebase  
**Replaces / Implements:** Docs `04` and `0e` at the implementation level

---

## 1. Purpose

This addendum specifies the exact implementation of the **sub-agent / executor privilege separation pattern**. This is the core security boundary of HelkinSwarm — it ensures that no LLM-bearing code can directly mutate data. All mutations go through a dumb, non-LLM executor that receives only concrete, pre-validated IDs.

Docs `04` (Safety Architecture) and `0e` (Verification Pipeline) describe the *requirement* for this pattern. This addendum specifies the *exact implementation*: the activity signatures, the routing logic, the session hash anti-tamper mechanism, the 3 guard rails of the token minter, and the wire-up from the tool dispatch layer.

---

## 2. The Core Invariant

```
Sub-Agent: LLM-bearing, read-only (or direct-tool-execution for known safe tools)
Executor:  Non-LLM, mutation-only, receives pre-validated concrete IDs
```

The orchestrator is the only component that knows the full intent. It:
1. Asks the sub-agent to *find* things (read operations)
2. Takes the sub-agent's output through the verification pipeline
3. Hands only vetted, concrete IDs to the executor for mutation

**No delete token, no write token, no permission-changing token ever reaches the sub-agent.**

---

## 3. Tool Dispatch Routing

### 3.1 Routing Decision

Every tool call from the LLM goes through `toolDispatchActivity`. This is where the privilege separation is enforced.

```typescript
// filepath: src/orchestrator/toolDispatchActivity.ts

export interface ToolDispatchInput {
  qualifiedToolName: string;   // e.g., "outlook_delete_emails"
  args: Record<string, unknown>;
  correlationId: string;
  sessionHash: string;        // SHA-256 of conversation ID + timestamp (anti-tamper)
  sessionTimestamp: number;    // Unix ms of session start
}

export interface ToolDispatchOutput {
  success: boolean;
  result?: unknown;
  error?: string;
  routedTo: "sub_agent" | "executor";
}

export df.app.activity("toolDispatchActivity", async (input: ToolDispatchInput): Promise<ToolDispatchOutput> => {
  const { qualifiedToolName, args, correlationId, sessionHash, sessionTimestamp } = input;

  // 1. Look up capability
  const capability = getCapability(qualifiedToolName);
  if (!capability) {
    return { success: false, error: `Unknown tool: ${qualifiedToolName}`, routedTo: "sub_agent" };
  }

  // 2. Route based on privilege
  switch (capability.privilege) {
    case "delete-only":
      // High-risk mutation: goes to executor
      return await routeToExecutor(input, capability);

    case "read-only":
      // Low-risk: goes to sub-agent for direct execution
      return await routeToSubAgent(input, capability);

    case "read-write":
      // Medium-risk: sub-agent executes directly for known tools,
      // LLM-assisted for novel tools
      if (isKnownSafeTool(qualifiedToolName)) {
        return await routeToSubAgent(input, capability);
      } else {
        // Novel tool: LLM-assisted with full pipeline
        return await routeToSubAgentWithLLM(input, capability);
      }

    default:
      return { success: false, error: `Unknown privilege: ${capability.privilege}`, routedTo: "sub_agent" };
  }
});
```

### 3.2 Privilege Levels

These map to the `privilege` field in each tool's capability manifest:

| Privilege | Description | Routed To |
|-----------|-------------|-----------|
| `read-only` | List, search, get operations | Sub-agent (direct execution) |
| `delete-only` | Destructive operations | Executor only |
| `read-write` | Create, update, send | Sub-agent (direct or LLM-assisted) |
| `delete-only + read-write` | Mixed (not allowed per tool) | Error — split into two tools |

---

## 4. Sub-Agent Activity

### 4.1 Interface

```typescript
// filepath: src/orchestrator/subAgentActivity.ts

export interface SubAgentInput {
  qualifiedToolName: string;
  toolArguments: Record<string, unknown>;
  correlationId: string;
  capability: CapabilityEntry;  // Full capability for this tool
}

export interface SubAgentOutput {
  success: boolean;
  result?: unknown;
  error?: string;
  executionMode: "direct" | "llm-assisted";
}
```

### 4.2 Direct Execution (Primary Path)

For known, well-defined tools, the sub-agent executes directly without LLM involvement:

```typescript
async function executeDirect(input: SubAgentInput): Promise<SubAgentOutput> {
  const { qualifiedToolName, toolArguments, correlationId } = input;

  // 1. Mint scoped token (read-only scope set)
  const token = await mintScopedToken({
    toolName: qualifiedToolName,
    privilege: "read-only",
    correlationId,
  });

  try {
    // 2. Execute tool directly (import from skills registry)
    const handler = getToolHandler(qualifiedToolName);
    const result = await handler(toolArguments, token);

    // 3. Verification pipeline (schema → minimize → spot-check)
    const verified = await runVerificationPipeline({
      toolName: qualifiedToolName,
      rawResult: result,
      correlationId,
    });

    return { success: true, result: verified, executionMode: "direct" };
  } finally {
    await revokeToken(token);
  }
}
```

### 4.3 LLM-Assisted Execution (Fallback Path)

For novel tools not in the known-safe list, the sub-agent uses the LLM to help construct the call — but still never receives mutation tokens:

```typescript
async function executeWithLLM(input: SubAgentInput): Promise<SubAgentOutput> {
  // 1. Mint token with extra caution — still no delete scopes
  const token = await mintScopedToken({
    toolName: input.qualifiedToolName,
    privilege: "read-only",  // Never delete scopes even in LLM-assisted mode
    correlationId: input.correlationId,
  });

  try {
    // 2. Call LLM with tool schema + arguments + output schema
    const llmResult = await routedChat(buildSubAgentPrompt(input), {
      model: "gpt-5-mini",  // Smaller, faster model for assistance
    });

    // 3. Parse LLM suggestion — validate before executing
    const suggestedArgs = validateToolArguments(llmResult.text, input.capability.inputSchema);
    if (!suggestedArgs) {
      return { success: false, error: "LLM suggested invalid arguments", executionMode: "llm-assisted" };
    }

    // 4. Execute with validated args
    const handler = getToolHandler(input.qualifiedToolName);
    const result = await handler(suggestedArgs, token);

    // 5. Full verification pipeline
    const verified = await runVerificationPipeline({
      toolName: input.qualifiedToolName,
      rawResult: result,
      correlationId: input.correlationId,
    });

    return { success: true, result: verified, executionMode: "llm-assisted" };
  } finally {
    await revokeToken(token);
  }
}
```

---

## 5. Executor Activity

### 5.1 Interface

```typescript
// filepath: src/orchestrator/executorActivity.ts

export interface ExecutorInput {
  domain: string;             // "outlook", "github", etc.
  action: string;             // "delete_emails", "close_issue", etc.
  targetIds: string[];       // Pre-validated concrete IDs only
  parameters: Record<string, unknown>;  // Non-ID parameters (e.g., move destination)
  correlationId: string;
  sessionHash: string;        // Anti-tamper hash
  sessionTimestamp: number;  // Anti-tamper timestamp
}

export interface ExecutorOutput {
  success: boolean;
  deletedCount?: number;
  error?: string;
}
```

### 5.2 Anti-Tamper Session Hash

Before the executor will act on any mutation, it validates the session hash. This prevents a compromised sub-agent from replaying stale IDs in a new session:

```typescript
async function validateSessionHash(input: ExecutorInput): Promise<boolean> {
  const { sessionHash, sessionTimestamp } = input;

  // 1. Timestamp must be within 5 minutes
  const age = Date.now() - sessionTimestamp;
  if (age > 5 * 60 * 1000) {
    console.warn(`[executor] Session too old: ${age}ms — rejecting`);
    return false;
  }

  // 2. Hash must match recomputed hash from conversation context
  const expectedHash = computeSessionHash(
    input.correlationId.split("-")[1],  // Use cc-XXXXXXXX part
    sessionTimestamp
  );
  if (sessionHash !== expectedHash) {
    console.warn(`[executor] Session hash mismatch — rejecting`);
    return false;
  }

  return true;
}
```

### 5.3 Executor Implementation

```typescript
export df.app.activity("executorActivity", async (input: ExecutorInput): Promise<ExecutorOutput> => {
  // 1. Validate session hash
  if (!await validateSessionHash(input)) {
    return { success: false, error: "Session validation failed" };
  }

  // 2. Mint delete-scoped token (never LLM-bearing)
  const token = await mintScopedToken({
    toolName: `${input.domain}_${input.action}`,
    privilege: "delete-only",
    correlationId: input.correlationId,
    scopes: DELETE_SCOPES[input.domain],  // e.g., ["Mail.ReadWrite"] for Outlook
  });

  try {
    // 3. Execute via domain executor
    const executor = domainExecutors[input.domain];
    if (!executor) {
      return { success: false, error: `No executor for domain: ${input.domain}` };
    }

    const result = await executor(input.action, input.targetIds, input.parameters, token);

    // 4. Log for audit
    await emitExecutorAudit({
      correlationId: input.correlationId,
      domain: input.domain,
      action: input.action,
      targetIds: input.targetIds,
      success: result.success,
    });

    return result;
  } finally {
    await revokeToken(token);
  }
});
```

### 5.4 Domain Executors (Stub — All TODO)

**This is the critical gap — all domain executors are stubs:**

```typescript
// filepath: src/orchestrator/executorActivity.ts

const domainExecutors: Record<string, DomainExecutor> = {
  outlook: async (action, ids, params, token) => {
    throw new Error("TODO: implement outlook executor — see ArchivalResearch/PASS6");
  },
  github: async (action, ids, params, token) => {
    throw new Error("TODO: implement github executor — see ArchivalResearch/PASS6");
  },
  entra: async (action, ids, params, token) => {
    throw new Error("TODO: implement entra executor — see ArchivalResearch/PASS6");
  },
  sharepoint: async (action, ids, params, token) => {
    throw new Error("TODO: implement sharepoint executor — see ArchivalResearch/PASS6");
  },
  teams: async (action, ids, params, token) => {
    throw new Error("TODO: implement teams executor — see ArchivalResearch/PASS6");
  },
  jira: async (action, ids, params, token) => {
    throw new Error("TODO: implement jira executor — see ArchivalResearch/PASS6");
  },
  azure: async (action, ids, params, token) => {
    throw new Error("TODO: implement azure executor — see ArchivalResearch/PASS6");
  },
};

type DomainExecutor = (
  action: string,
  targetIds: string[],
  parameters: Record<string, unknown>,
  token: ScopedToken
) => Promise<{ success: boolean; deletedCount?: number; error?: string }>;
```

Each stub must be replaced with an actual implementation that:
1. Calls the Graph API / GitHub API / etc. using the provided `token`
2. Operates **only** on the `targetIds` provided — no wildcards, no queries
3. Logs every action to App Insights
4. Returns concrete counts (how many deleted, how many failed)

---

## 6. Scoped Token Minter — 3 Guard Rails

The token minter is the foundation of the privilege system. Every token minted must pass all 3 guard rails:

### 6.1 Guard Rail 1: Privilege-to-Scopes Mapping

```typescript
// filepath: src/auth/scopedTokenMinter.ts

const PRIVILEGE_TO_SCOPES: Record<string, Record<string, string[]>> = {
  "read-only": {
    outlook: ["Mail.Read"],
    github: ["repos:read"],
    entra: ["User.ReadBasic.All"],
    sharepoint: ["Sites.Read.All"],
    teams: ["Channel.Read.All"],
    jira: ["read:jira-work"],
    azure: ["reader"],
  },
  "delete-only": {
    outlook: ["Mail.ReadWrite"],  // Note: no Delete scope — deletion is ID-specific, not blanket
    github: ["repos:write"],       // Still limited to specific repos via token audience
    entra: [],                     // Entra deletions require admin — deny by default
    sharepoint: ["Sites.ReadWrite.All"],
    teams: ["Channel.ReadWrite.All"],
    jira: ["write:jira-work"],
    azure: [],                     // Azure deletions handled via Resource Graph, not raw scopes
  },
};

// Guard rail: if a domain has no delete scopes, delete operations are denied entirely
function validateDeleteScopes(domain: string): void {
  const scopes = PRIVILEGE_TO_SCOPES["delete-only"][domain];
  if (!scopes || scopes.length === 0) {
    throw new Error(`DELETE_NOT_ALLOWED: ${domain} does not support delete operations`);
  }
}
```

### 6.2 Guard Rail 2: LLM-Bearing Flag

```typescript
// filepath: src/auth/scopedTokenMinter.ts

interface MintInput {
  toolName: string;
  privilege: "read-only" | "delete-only";
  correlationId: string;
  scopes?: string[];  // Override auto-mapping (for advanced cases)
  isLlmBearing?: boolean;  // Set true if this token will be used by LLM-assisted code
}

// Guard rail: if isLlmBearing=true, delete scopes are denied
function validateLlmBearingFlag(input: MintInput): void {
  if (input.isLlmBearing && input.privilege === "delete-only") {
    throw new Error("ILLEGAL_TOKEN_REQUEST: Cannot issue delete-scoped token to LLM-bearing component");
  }
}
```

### 6.3 Guard Rail 3: Time-to-Live Cap

```typescript
// filepath: src/auth/scopedTokenMinter.ts

const TTL_MS = 5 * 60 * 1000;  // 5 minutes — hard cap

function validateTTL(requestedTtlMs: number): number {
  if (requestedTtlMs > TTL_MS) {
    console.warn(`[scoped-token-minter] Requested TTL ${requestedTtlMs}ms exceeds cap ${TTL_MS}ms — capping`);
    return TTL_MS;
  }
  return requestedTtlMs;
}
```

### 6.4 Complete Mint Flow

```typescript
export async function mintScopedToken(input: MintInput): Promise<ScopedToken> {
  // Guard rail 1: privilege → scopes mapping
  const baseScopes = input.scopes ?? PRIVILEGE_TO_SCOPES[input.privilege][getDomain(input.toolName)];
  if (!baseScopes) {
    throw new Error(`UNKNOWN_DOMAIN: ${input.toolName}`);
  }

  // Guard rail 2: LLM-bearing flag
  if (input.isLlmBearing && input.privilege === "delete-only") {
    throw new Error("ILLEGAL_TOKEN_REQUEST: LLM-bearing delete token denied");
  }

  // Guard rail 3: TTL cap
  const ttl = validateTTL(input.requestedTtlMs ?? TTL_MS);

  // Issue token via OBO flow or UAMI depending on context
  const token = await (input.useObo
    ? mintOboToken(input.userUpn, baseScopes)
    : mintUamiToken(baseScopes));

  return {
    token,
    scopes: baseScopes,
    expiresAt: Date.now() + ttl,
    correlationId: input.correlationId,
    isLlmBearing: input.isLlmBearing ?? false,
  };
}
```

---

## 7. Verification Pipeline Integration

Both sub-agent and executor results pass through the verification pipeline before the orchestrator accepts them:

```typescript
// filepath: src/orchestrator/verificationPipeline.ts

export interface VerificationInput {
  toolName: string;
  rawResult: unknown;
  correlationId: string;
}

export interface VerificationOutput {
  verified: unknown;       // Minimized, validated result
  passed: boolean;
  steps: VerificationStepResult[];
  anomalyDetected: boolean;
}

interface VerificationStepResult {
  step: "schema_validation" | "data_minimization" | "spot_check";
  passed: boolean;
  details?: string;
  durationMs: number;
}

export async function runVerificationPipeline(input: VerificationInput): Promise<VerificationOutput> {
  const capability = getCapability(input.toolName);
  const steps: VerificationStepResult[] = [];

  // Step 1: Schema validation
  const schemaResult = await validateSchema(input.rawResult, capability.outputSchema);
  steps.push({ step: "schema_validation", passed: schemaResult.passed, details: schemaResult.error });

  // Step 2: Data minimization
  const minimized = await minimizeData(input.rawResult, capability.outputSchema);
  steps.push({ step: "data_minimization", passed: true, details: `Removed ${minimized.removedCount} fields` });

  // Step 3: Spot-check (for high-sensitivity tools)
  let spotCheckPassed = true;
  let anomalyDetected = false;
  if (capability.dataSensitivity === "pii" || capability.risk === "high") {
    const spotResult = await spotCheck(minimized.data, capability);
    spotCheckPassed = spotResult.passed;
    anomalyDetected = spotResult.anomaly;
    steps.push({ step: "spot_check", passed: spotCheckPassed, details: spotResult.details });
  } else {
    steps.push({ step: "spot_check", passed: true, details: "skipped (low sensitivity)" });
  }

  // Emit App Insights events
  for (const step of steps) {
    telemetryClient.trackEvent({
      name: "VerificationStep",
      correlationId: input.correlationId,
      toolName: input.toolName,
      ...step,
    });
  }

  const allPassed = steps.every(s => s.passed);

  return {
    verified: minimized.data,
    passed: allPassed,
    steps,
    anomalyDetected,
  };
}
```

---

## 8. Key Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/orchestrator/toolDispatchActivity.ts` | **Modify** | Add privilege-based routing (read/delete/read-write) |
| `src/orchestrator/subAgentActivity.ts` | **Create** | Sub-agent with direct + LLM-assisted paths |
| `src/orchestrator/executorActivity.ts` | **Create** | Executor with session hash validation |
| `src/auth/scopedTokenMinter.ts` | **Create** | 3 guard rails, OBO + UAMI minting |
| `src/orchestrator/verificationPipeline.ts` | **Create** | Schema → minimize → spot-check |
| `src/orchestrator/schemaValidator.ts` | **Create** | Zod-based output validation |
| `src/orchestrator/dataMinimizer.ts` | **Create** | Field stripping per outputSchema |
| `src/orchestrator/spotChecker.ts` | **Create** | Fisher-Yates sampling + parallel fetch |
| `src/orchestrator/humanConfirmation.ts` | **Create** | Adaptive Card for high-risk confirmations |
| `src/capabilities/capabilityLoader.ts` | **Modify** | Ensure `privilege` field is required in manifest |

---

## 9. Capability Manifest Extension

Each tool's entry in the skill's `manifest.json` must include these fields for the routing to work:

```json
{
  "name": "outlook_delete_emails",
  "privilege": "delete-only",
  "risk": "high",
  "outputSchema": {
    "type": "object",
    "properties": {
      "deletedCount": { "type": "integer" },
      "failedIds": { "type": "array", "items": { "type": "string" } }
    }
  }
}
```

| New Field | Required | Notes |
|-----------|----------|-------|
| `privilege` | Yes | `read-only` \| `delete-only` \| `read-write` |
| `outputSchema` | Yes | Zod schema for verification pipeline |

---

## 10. Not in Scope (Per This Addendum)

- The `privilege` field in the capability schema — handled by `ADDENDA-04` (Capability Hot-Reload + Tool Registry)
- The token minting backend (OBO vs UAMI) — handled by `ADDENDA-05` (Auth + Identity Layer)
- The App Insights audit events for executor — specified here, implemented in `ADDENDA-01`

---

## 11. Acceptance Criteria

1. Every tool call is routed correctly by privilege: `delete-only` → executor, `read-only` → sub-agent direct, `read-write` → sub-agent direct/LLM-assisted
2. Executor activity rejects any request with invalid session hash or stale timestamp
3. Token minter denies delete-scoped tokens to LLM-bearing components (Guard Rail 2)
4. Token minter caps TTL at 5 minutes (Guard Rail 3)
5. Verification pipeline runs on every tool result before the orchestrator accepts it
6. Schema validation failures cause the turn to abort with user notification
7. Spot-check on high-sensitivity tools flags anomalies for human review
