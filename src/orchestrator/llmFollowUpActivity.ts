// LLM Follow-Up activity — second LLM call after tool execution.
// Sends tool results back to the model so it can generate a natural language response.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import { FoundryClient } from '../llm/foundryClient.js';
import { getModelRouting, getModelForTask } from '../llm/modelRouter.js';
import type { ChatMessage, ChatCompletionResponse } from '../llm/foundryClient.js';
import type { LlmResult } from './llmActivity.js';

export interface LlmFollowUpInput {
  /** Original conversation messages (system + user). */
  originalMessages: Array<{ role: string; content: string }>;
  /** The assistant message that contained tool_calls. */
  assistantToolCallMessage: {
    content: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
  };
  /** Tool execution results to feed back to the model. */
  toolResults: Array<{
    toolCallId: string;
    toolName: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }>;
  correlationId: string;
  modelOverride?: 'primary' | 'secondary';
}

df.app.activity('llmFollowUpActivity', {
  handler: async (input: LlmFollowUpInput): Promise<LlmResult> => {
    const routing = getModelRouting();
    const correlationId = input.correlationId ?? crypto.randomUUID();

    const deploymentName = input.modelOverride === 'secondary'
      ? (process.env['LLM_SECONDARY_MODEL'] ?? getModelForTask('fast'))
      : input.modelOverride === 'primary'
        ? (process.env['LLM_PRIMARY_MODEL'] ?? getModelForTask('reasoning'))
        : routing.deploymentName;

    const client = new FoundryClient({ ...routing, deploymentName });

    // Build the full conversation: original messages + assistant tool_calls + tool results
    const messages: ChatMessage[] = [
      // Original system + user messages
      ...input.originalMessages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
      })),
      // Assistant message that requested tool calls
      {
        role: 'assistant' as const,
        content: input.assistantToolCallMessage.content || '',
        toolCalls: input.assistantToolCallMessage.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      },
      // Tool result messages
      ...input.toolResults.map((tr) => ({
        role: 'tool' as const,
        content: tr.success
          ? JSON.stringify(tr.result)
          : `Error: ${tr.error}`,
        toolCallId: tr.toolCallId,
      })),
    ];

    try {
      const response: ChatCompletionResponse = await client.chatCompletion({
        messages,
        maxTokens: 4096,
        temperature: 0.7,
        correlationId,
      });

      const choice = response.choices[0];

      return {
        content: choice.message.content ?? 'Tool execution complete.',
        model: response.model,
        tokensUsed: response.usage.totalTokens,
        toolCalls: [], // Follow-up should not request more tools (single-turn tool use)
        finishReason: choice.finishReason,
      };
    } catch (err) {
      return {
        content: `Follow-up LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        model: routing.deploymentName,
        tokensUsed: 0,
        toolCalls: [],
        finishReason: 'error',
      };
    }
  },
});
