// Tool dispatch activity — routes LLM tool_calls to their handlers.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import { toolRegistry } from '../tools/toolRegistry.js';
import { getHandler } from '../capabilities/capabilityLoader.js';
import { trackEvent } from '../observability/telemetry.js';
import { MemoryManager } from '../memory/memoryManager.js';
import { canInvokeTool } from '../auth/roles.js';
import { scopedTokenMinter } from '../auth/scopedTokenMinter.js';
import type { ScopedTokenScope } from '../auth/scopedTokenMinter.js';
import { mapPrivilegeClassToScopedTokenScope } from '../auth/tokenScopeMapping.js';

export interface ToolDispatchInput {
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  correlationId: string;
  sessionId: string;
  userId: string;
  conversationId?: string;
}

export interface ToolDispatchResult {
  results: Array<{
    toolCallId: string;
    toolName: string;
    success: boolean;
    result?: unknown;
    error?: string;
    requiresExecutor: boolean;
    scopedTokenMinted?: boolean;
    scopedTokenMethod?: 'obo' | 'placeholder';
    scopedTokenScope?: ScopedTokenScope;
  }>;
  totalCalls: number;
}

df.app.activity('toolDispatchActivity', {
  handler: async (input: ToolDispatchInput): Promise<ToolDispatchResult> => {
    const results: ToolDispatchResult['results'] = [];

    for (const call of input.toolCalls) {
      const tool = toolRegistry.get(call.name);

      if (!tool) {
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          success: false,
          error: `Tool not found: ${call.name}`,
          requiresExecutor: false,
        });
        continue;
      }

      // Defense-in-depth: reject tools that violate current safety mode (#210)
      if (!toolRegistry.isAllowedBySafetyMode(call.name)) {
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          success: false,
          error: `Tool ${call.name} (risk: ${tool.risk}) blocked by safety mode`,
          requiresExecutor: false,
        });
        continue;
      }

      // Application-level RBAC — check role before executing privileged tools (#248)
      const allowed = await canInvokeTool(input.userId, call.name);
      if (!allowed) {
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          success: false,
          error: `Tool ${call.name} requires owner role. Current user does not have sufficient privileges.`,
          requiresExecutor: false,
        });
        continue;
      }

      if (tool.requiresExecutor) {
        // High-risk tool — mark for executor, don't execute here
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          success: true,
          result: { status: 'requires-executor', toolName: call.name },
          requiresExecutor: true,
        });
        continue;
      }

      // Low/medium risk — dispatch to handler
      try {
        const parsedArgs = JSON.parse(call.arguments) as Record<string, unknown>;
        let scopedTokenMinted = false;
        let scopedTokenMethod: 'obo' | 'placeholder' | undefined;
        let scopedTokenScope: ScopedTokenScope | undefined;
        // Inject session context (userId, conversationId) so handlers can access it without cross-boundary imports
        parsedArgs['userId'] = input.userId;
        parsedArgs['correlationId'] = input.correlationId;
        if (input.conversationId) parsedArgs['conversationId'] = input.conversationId;

        // Mint scoped token for non-read-only tools (#317)
        const tokenScope = mapPrivilegeClassToScopedTokenScope(tool.privilegeClass);
        if (tokenScope) {
          try {
            const domain = tool.handlerModule?.replace('skills/', '') || 'core';
            const scopedToken = await scopedTokenMinter.mint({
              toolName: call.name,
              scope: tokenScope,
              targetResource: domain,
              userId: input.userId,
              correlationId: input.correlationId,
            });
            parsedArgs['_scopedToken'] = scopedToken.token;
            parsedArgs['_scopedTokenScope'] = scopedToken.scope;
            parsedArgs['_scopedTokenMethod'] = scopedToken.method;
            scopedTokenMinted = true;
            scopedTokenMethod = scopedToken.method;
            scopedTokenScope = scopedToken.scope;
          } catch {
            // Non-fatal: handler falls back to legacy token acquisition (#318)
          }
        }

        const handler = getHandler(call.name);

        if (!handler) {
          results.push({
            toolCallId: call.id,
            toolName: call.name,
            success: false,
            error: `No handler registered for tool: ${call.name}`,
            requiresExecutor: false,
          });
          continue;
        }

        const result = await handler(parsedArgs);
        trackEvent({ name: 'ToolExecuted', correlationId: input.correlationId, userId: input.userId, properties: {
          toolName: call.name,
          success: true,
        } });

        // Store tool result as skill memory for JIT injection (#66)
        if (tool.handlerModule) {
          const skillId = tool.handlerModule.replace('skills/', '');
          const mm = new MemoryManager(input.userId);
          mm.storeToolResult(skillId, call.name, JSON.stringify(result)).catch(() => { /* non-fatal */ });
        }

        results.push({
          toolCallId: call.id,
          toolName: call.name,
          success: true,
          result,
          requiresExecutor: false,
          scopedTokenMinted,
          scopedTokenMethod,
          scopedTokenScope,
        });
      } catch (err) {
        trackEvent({ name: 'ToolExecuted', correlationId: input.correlationId, userId: input.userId, properties: {
          toolName: call.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        } });
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          requiresExecutor: false,
        });
      }
    }

    return {
      results,
      totalCalls: results.length,
    };
  },
});
