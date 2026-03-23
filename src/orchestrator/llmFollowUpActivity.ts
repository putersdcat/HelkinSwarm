// LLM Follow-Up activity — second LLM call after tool execution.
// Sends tool results back to the model so it can generate a natural language response.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../llm/foundryClient.js';
import { getModelRouting } from '../llm/modelRouter.js';
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

    // Use reasoning model for /heavy, fast model for /light, else default (#185)
    let deploymentName: string;
    let isReasoning = routing.isReasoning;
    if (input.modelOverride === 'secondary') {
      deploymentName = routing.lane.secondary;
      isReasoning = false;
    } else if (input.modelOverride === 'primary') {
      deploymentName = routing.lane.reasoning ?? routing.lane.primary;
      isReasoning = true;
    } else {
      deploymentName = routing.deploymentName;
    }

    const client = new FoundryClient({ ...routing, deploymentName, isReasoning });

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
      // Tool result messages — cap each result to prevent context window blowout (#184)
      ...input.toolResults.map((tr) => {
        let content: string;
        if (!tr.success) {
          content = `Error: ${tr.error}`;
        } else {
          content = JSON.stringify(tr.result);
          if (content.length > 8000) {
            content = content.slice(0, 7950) + '…" (truncated — full result was ' + content.length + ' chars)';
          }
        }
        return {
          role: 'tool' as const,
          content,
          toolCallId: tr.toolCallId,
        };
      }),
    ];

    try {
      const response: ChatCompletionResponse = await client.chatCompletion({
        messages,
        maxTokens: 4096,
        temperature: 0.7,
        correlationId,
      });

      const choice = response.choices[0];
      let llmContent = textContent(choice.message.content);

      // If the LLM returned empty content (usually because it requested more tool_calls
      // that we don't support in single-turn), retry WITHOUT tools to force text (#186).
      if (!llmContent && choice.finishReason === 'tool_calls') {
        console.log(`[llmFollowUpActivity] LLM requested more tools (single-turn limit). Retrying without tools.`);
        const retryResponse: ChatCompletionResponse = await client.chatCompletion({
          messages: [
            ...messages,
            { role: 'assistant' as const, content: 'I have all the data I need from the tools. Let me summarize.' },
          ],
          maxTokens: 4096,
          temperature: 0.7,
          correlationId,
        });
        llmContent = textContent(retryResponse.choices[0].message.content);
      }

      // If the LLM still returned empty content, build a concise summary from tool results
      // rather than dumping raw JSON that may exceed Teams message limits (#184).
      let content: string;
      if (llmContent) {
        content = llmContent;
      } else {
        const summaries = input.toolResults.map((tr) => {
          if (!tr.success) return `**${tr.toolName}** failed: ${tr.error ?? 'unknown error'}`;
          const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result, null, 2);
          // Cap individual tool summaries to prevent oversized messages
          if (resultStr.length > 2000) {
            return `**${tr.toolName}**: (result too large to display inline — ${resultStr.length} chars)`;
          }
          return `**${tr.toolName}**: ${resultStr}`;
        });
        content = summaries.join('\n\n');
      }

      return {
        content,
        model: response.model,
        tokensUsed: response.usage.totalTokens,
        promptTokens: response.usage.promptTokens,
        toolCalls: [], // Follow-up should not request more tools (single-turn tool use)
        finishReason: choice.finishReason,
      };
    } catch (err) {
      return {
        content: `Follow-up LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        model: routing.deploymentName,
        tokensUsed: 0,
        promptTokens: 0,
        toolCalls: [],
        finishReason: 'error',
      };
    }
  },
});
