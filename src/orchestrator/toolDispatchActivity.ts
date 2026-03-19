// Tool dispatch activity — routes LLM tool_calls to their handlers.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import { toolRegistry } from '../tools/toolRegistry.js';

export interface ToolDispatchInput {
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  correlationId: string;
  sessionId: string;
  userId: string;
}

export interface ToolDispatchResult {
  results: Array<{
    toolCallId: string;
    toolName: string;
    success: boolean;
    result?: unknown;
    error?: string;
    requiresExecutor: boolean;
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

      // Low/medium risk — dispatch to handler (Phase 3 stub)
      try {
        const parsedArgs = JSON.parse(call.arguments);
        // Phase 3: real handler dispatch via skill module import
        const result = { status: 'stub', toolName: call.name, args: parsedArgs };
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          success: true,
          result,
          requiresExecutor: false,
        });
      } catch (err) {
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
