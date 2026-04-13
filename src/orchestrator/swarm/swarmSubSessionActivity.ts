// Swarm Sub-Session Activity — executes a single elevated-permission tool in an isolated scope.
// Only invoked by swarmOrchestrator for tools with requiresSubAgent: true (#638 Slice 2).
// The worker cannot run these tools directly (gated in swarmWorkerActivity); instead it emits
// a sub_session_request chatroom message, and the orchestrator calls this activity to fulfill it.
// Spec ref: docs/0zk-Swarm-Integration-with-Existing-Sub-Session-Security-Model.md
// Epic: #631 / #638

import * as df from 'durable-functions';
import { toolRegistry } from '../../tools/toolRegistry.js';
import { getHandler } from '../../capabilities/capabilityLoader.js';
import { trackEvent } from '../../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export interface SwarmSubSessionInput {
  /** Tool name with requiresSubAgent: true to execute. */
  toolName: string;
  /** Arguments from the worker's original tool call (user-provided via LLM). */
  toolArgs: Record<string, unknown>;
  /** Agent name that requested this sub-session (for result routing). */
  requestingAgent: string;
  /** Sub_session_request message ID for reply correlation. */
  requestMessageId: string;
  userId: string;
  correlationId: string;
  swarmId: string;
  swarmCorrelationId: string;
}

export interface SwarmSubSessionResult {
  requestingAgent: string;
  toolName: string;
  success: boolean;
  /** Tool output string (or error message). */
  resultContent: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

df.app.activity('swarmSubSessionActivity', {
  handler: async (input: SwarmSubSessionInput): Promise<SwarmSubSessionResult> => {
    const startMs = Date.now();

    // Defense in depth: verify the tool is known and actually requires sub-agent routing.
    // Workers should only submit requiresSubAgent tools, but we validate again here.
    const toolDef = toolRegistry.get(input.toolName);
    if (!toolDef) {
      return {
        requestingAgent: input.requestingAgent,
        toolName: input.toolName,
        success: false,
        resultContent: `Sub-session denied: unknown tool "${input.toolName}"`,
        durationMs: Date.now() - startMs,
      };
    }

    if (!toolDef.requiresSubAgent) {
      return {
        requestingAgent: input.requestingAgent,
        toolName: input.toolName,
        success: false,
        resultContent: `Sub-session denied: tool "${input.toolName}" does not require sub-agent routing`,
        durationMs: Date.now() - startMs,
      };
    }

    if (!toolRegistry.isAllowedBySafetyMode(input.toolName)) {
      trackEvent({
        name: 'SwarmSubSessionBlocked',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: { toolName: input.toolName, requestingAgent: input.requestingAgent, swarmId: input.swarmId },
      });
      return {
        requestingAgent: input.requestingAgent,
        toolName: input.toolName,
        success: false,
        resultContent: `Sub-session denied: tool "${input.toolName}" blocked by safety mode`,
        durationMs: Date.now() - startMs,
      };
    }

    const handler = getHandler(input.toolName);
    if (!handler) {
      return {
        requestingAgent: input.requestingAgent,
        toolName: input.toolName,
        success: false,
        resultContent: `Sub-session failed: no handler registered for "${input.toolName}"`,
        durationMs: Date.now() - startMs,
      };
    }

    try {
      const handlerArgs: Record<string, unknown> = {
        ...input.toolArgs,
        userId: input.userId,
        correlationId: input.correlationId,
      };
      const rawResult = await handler(handlerArgs);
      const resultContent = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);

      trackEvent({
        name: 'SwarmSubSessionCompleted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          toolName: input.toolName,
          requestingAgent: input.requestingAgent,
          swarmId: input.swarmId,
          success: 'true',
          durationMs: String(Date.now() - startMs),
        },
      });

      return {
        requestingAgent: input.requestingAgent,
        toolName: input.toolName,
        success: true,
        resultContent,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trackEvent({
        name: 'SwarmSubSessionError',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          toolName: input.toolName,
          requestingAgent: input.requestingAgent,
          swarmId: input.swarmId,
          error: msg.slice(0, 300),
        },
      });
      return {
        requestingAgent: input.requestingAgent,
        toolName: input.toolName,
        success: false,
        resultContent: `Sub-session error: ${msg}`,
        durationMs: Date.now() - startMs,
      };
    }
  },
});
