// LLM Follow-Up activity — second LLM call after tool execution.
// Sends tool results back to the model so it can generate a natural language response.
// When enableRetry is set, tools are passed to the LLM so it can request corrective
// tool calls (e.g., retry after a 422 error with fixed params). The orchestrator
// handles the actual dispatch loop. (#182, #186)
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../llm/foundryClient.js';
import { getDirectChatModelIncompatibilityReason, getModelRouting } from '../llm/modelRouter.js';
import type { ChatMessage, ChatCompletionResponse, ToolDefinition } from '../llm/foundryClient.js';
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
  modelOverride?: string;
  /** When true, pass tools to the LLM so it can request retry calls (#182). */
  enableRetry?: boolean;
  /** Tool definitions to pass when enableRetry is true. */
  tools?: ToolDefinition[];
  /** Additional assistant+tool turn pairs from retry iterations (#182). */
  additionalTurns?: Array<{
    assistantContent: string;
    assistantToolCalls: Array<{ id: string; name: string; arguments: string }>;
    toolResults: Array<{
      toolCallId: string;
      toolName: string;
      success: boolean;
      result?: unknown;
      error?: string;
    }>;
  }>;
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
    } else if (input.modelOverride && input.modelOverride !== 'primary' && input.modelOverride !== 'secondary') {
      // Direct deployment name override via /model command (#217)
      const incompatibilityReason = getDirectChatModelIncompatibilityReason(input.modelOverride);
      if (incompatibilityReason) {
        return {
          content: `Follow-up LLM call skipped: direct model override \"${input.modelOverride}\" is unsupported because it ${incompatibilityReason}.`,
          model: input.modelOverride,
          tokensUsed: 0,
          promptTokens: 0,
          toolCalls: [],
          finishReason: 'error',
        };
      }
      deploymentName = input.modelOverride;
      isReasoning = deploymentName.includes('reasoning') || deploymentName.startsWith('o');
    } else {
      deploymentName = routing.deploymentName;
    }

    const client = new FoundryClient({ ...routing, deploymentName, isReasoning });

    // Helper to format tool results as chat messages
    const formatToolResults = (results: LlmFollowUpInput['toolResults']): ChatMessage[] =>
      results.map((tr) => {
        let content: string;
        if (!tr.success) {
          content = `Error: ${tr.error}`;
        } else {
          content = JSON.stringify(tr.result);
          if (content.length > 8000) {
            content = content.slice(0, 7950) + '…" (truncated — full result was ' + content.length + ' chars)';
          }
        }
        return { role: 'tool' as const, content, toolCallId: tr.toolCallId };
      });

    // Build the full conversation: original messages + assistant tool_calls + tool results
    const messages: ChatMessage[] = [
      // Original system + user messages
      ...input.originalMessages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
      })),
      // First assistant message that requested tool calls
      {
        role: 'assistant' as const,
        content: input.assistantToolCallMessage.content || '',
        toolCalls: input.assistantToolCallMessage.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      },
      // First round of tool results — cap each to prevent context window blowout (#184)
      ...formatToolResults(input.toolResults),
      // Additional turns from retry iterations (#182)
      ...(input.additionalTurns ?? []).flatMap((turn) => [
        {
          role: 'assistant' as const,
          content: turn.assistantContent || '',
          toolCalls: turn.assistantToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        },
        ...formatToolResults(turn.toolResults),
      ]),
    ];

    try {
      // When enableRetry is set, pass tools so the LLM can request corrective calls (#182).
      const retryTools = input.enableRetry && input.tools?.length ? input.tools : undefined;
      const response: ChatCompletionResponse = await client.chatCompletion({
        messages,
        tools: retryTools,
        toolChoice: retryTools ? 'auto' : undefined,
        maxTokens: 4096,
        temperature: 0.7,
        correlationId,
      });

      const choice = response.choices[0];
      let llmContent = textContent(choice.message.content);

      // If tools were provided and LLM wants to retry with corrected params,
      // return the tool calls to the orchestrator for dispatch (#182).
      const retryToolCalls = choice.message.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })) ?? [];

      if (!llmContent && retryToolCalls.length > 0 && retryTools) {
        console.log(`[llmFollowUpActivity] LLM requested ${retryToolCalls.length} retry tool call(s) (#182).`);
        return {
          content: llmContent ?? '',
          model: response.model,
          tokensUsed: response.usage.totalTokens,
          promptTokens: response.usage.promptTokens,
          toolCalls: retryToolCalls,
          finishReason: choice.finishReason,
        };
      }

      // If the LLM returned empty content without retry tools (usually because it requested
      // more tool_calls that we don't support), retry WITHOUT tools to force text (#186).
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
        toolCalls: [],
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
