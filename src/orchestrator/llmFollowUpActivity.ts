// LLM Follow-Up activity — second LLM call after tool execution.
// Sends tool results back to the model so it can generate a natural language response.
// When enableRetry is set, tools are passed to the LLM so it can request corrective
// tool calls (e.g., retry after a 422 error with fixed params). The orchestrator
// handles the actual dispatch loop. (#182, #186)
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import {
  buildLlmFailureNotice,
  buildSuccessfulFailoverNotices,
  FoundryClient,
  textContent,
} from '../llm/foundryClient.js';
import { getDirectChatModelIncompatibilityReason, getModelRouting } from '../llm/modelRouter.js';
import type { ChatMessage, ChatCompletionResponse, ToolDefinition } from '../llm/foundryClient.js';
import type { LlmResult } from './llmActivity.js';
import { synthesizeDeterministicFollowUpToolCall } from './discoveryToolInjection.js';

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
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
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

const FOLLOW_UP_EXECUTION_PROMPT =
  'You are continuing an in-progress tool workflow. Do not stop at intermediate retrieval results when the user requested a later action. ' +
  'If the request is not yet fulfilled and more tools are available, call the next required tool. ' +
  'A discovery/search result that only identifies candidate tools is NOT fulfillment when the user asked you to send, reply, create, update, or delete something. ' +
  'After discovery narrows the tool set, call the concrete discovered tool that completes the user intent. ' +
  'Never return raw tool dumps or discovery blobs to the user as the final answer. ' +
  'Only answer with a final natural-language response when the full user intent is satisfied or you can explain a specific blocker.';

function getLatestUserMessage(originalMessages: Array<{ role: string; content: string }>): string {
  return [...originalMessages]
    .reverse()
    .find((message) => message.role === 'user')?.content ?? '';
}

function isReadOnlyOrDiscoveryTool(toolName: string): boolean {
  return toolName === 'helkin_skill_search'
    || /_(list|read|search|download|get)_/.test(toolName);
}

function buildDefaultToolSummary(toolResults: LlmFollowUpInput['toolResults']): string {
  const summaries = toolResults.map((tr) => {
    if (!tr.success) return `**${tr.toolName}** failed: ${tr.error ?? 'unknown error'}`;
    const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result, null, 2);
    if (resultStr.length > 2000) {
      return `**${tr.toolName}**: (result too large to display inline — ${resultStr.length} chars)`;
    }
    return `**${tr.toolName}**: ${resultStr}`;
  });
  return summaries.join('\n\n');
}

export function buildFallbackToolResultContent(
  originalMessages: Array<{ role: string; content: string }>,
  toolResults: LlmFollowUpInput['toolResults'],
): string {
  const latestUserMessage = getLatestUserMessage(originalMessages);
  const requestedAction = /\b(send|reply|draft|create|update|delete|move|forward|schedule|email|mail)\b/i.test(latestUserMessage);
  const requestedInlineMedia = /\b(inline|gif|image|photo|png|jpg|jpeg|webp)\b/i.test(latestUserMessage);
  const onlyReadOnlyOrDiscovery = toolResults.length > 0 && toolResults.every((tr) => isReadOnlyOrDiscoveryTool(tr.toolName));
  const inlineEmailSendFailure = toolResults.find((tr) =>
    tr.toolName === 'outlook_send_email'
    && !tr.success
    && /embedded inline images|inline-image email|cid: inline image|data:image/i.test(tr.error ?? ''),
  );

  if (inlineEmailSendFailure) {
    return 'I couldn’t complete that email request. Outlook inline embedded images from Teams/runtime assets are not supported yet, so I did not send the requested inline-image email.';
  }

  const missingRuntimeInlineAssetFailure = requestedInlineMedia
    ? toolResults.find((tr) =>
      tr.toolName === 'outlook_send_email'
      && !tr.success
      && /runtime asset .* is not available anymore|upload or re-materialize it again/i.test(tr.error ?? ''),
    )
    : undefined;

  if (missingRuntimeInlineAssetFailure) {
    return 'I couldn’t complete that inline-image email. The referenced runtime asset is no longer available, so I did not send the email. Please upload or re-materialize the image again and retry.';
  }

  if (requestedAction && requestedInlineMedia && onlyReadOnlyOrDiscovery) {
    return 'I couldn’t complete that request. I only reached discovery/read steps, and HelkinSwarm does not yet have a reliable path to send an Outlook email with a Teams-provided image or GIF embedded inline in the message body. I did not send the requested inline-image email.';
  }

  if (requestedAction && onlyReadOnlyOrDiscovery) {
    return 'I couldn’t complete the requested action. I only reached search/read steps and did not actually send, create, update, or delete anything.';
  }

  return buildDefaultToolSummary(toolResults);
}

export function shouldStopOnRepeatedToolFailure(
  candidateToolCalls: Array<{ name: string; arguments: string }>,
  additionalTurns: LlmFollowUpInput['additionalTurns'] = [],
): boolean {
  if (candidateToolCalls.length === 0 || additionalTurns.length === 0) {
    return false;
  }

  const deterministicallyBlockedToolNames = new Set(
    additionalTurns.flatMap((turn) =>
      turn.toolResults
        .filter((result) =>
          !result.success
          && /not supported yet|does not support|not available|cannot send|blocked by safety pipeline|i have not sent/i.test(result.error ?? ''),
        )
        .map((result) => result.toolName),
    ),
  );

  return candidateToolCalls.every((call) => deterministicallyBlockedToolNames.has(call.name));
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
          content: `Follow-up LLM call skipped: direct model override "${input.modelOverride}" is unsupported because it ${incompatibilityReason}.`,
          model: input.modelOverride,
          tokensUsed: 0,
          promptTokens: 0,
          toolCalls: [],
          finishReason: 'error',
          operationalNotices: [],
        };
      }
      deploymentName = input.modelOverride;
      isReasoning = deploymentName.includes('reasoning') || deploymentName.startsWith('o');
    } else {
      deploymentName = routing.deploymentName;
    }

    const client = new FoundryClient({ ...routing, deploymentName, isReasoning });

    // Helper to format tool results as chat messages.
    // Smart truncation: for arrays, keep first N items with a count summary instead of
    // slicing mid-JSON which confuses follow-up models (#234).
    const smartTruncate = (result: unknown, limit: number): string => {
      const full = JSON.stringify(result);
      if (full.length <= limit) return full;

      // If result is an array, keep first items and add count
      if (Array.isArray(result)) {
        let kept = 0;
        let partial = '';
        for (let i = 0; i < result.length; i++) {
          const item = JSON.stringify(result[i]);
          if (partial.length + item.length + 50 > limit) break;
          partial += (i > 0 ? ',' : '') + item;
          kept = i + 1;
        }
        return `[${partial}] (showing ${kept}/${result.length} items — full result was ${full.length} chars)`;
      }

      // For objects/primitives, slice with a clean suffix
      return full.slice(0, limit - 80) + `… (truncated — full result was ${full.length} chars)`;
    };

    const formatToolResults = (results: LlmFollowUpInput['toolResults']): ChatMessage[] =>
      results.map((tr) => {
        let content: string;
        if (!tr.success) {
          content = `Error: ${tr.error}`;
        } else {
          content = smartTruncate(tr.result, 8000);
        }
        return { role: 'tool' as const, content, toolCallId: tr.toolCallId };
      });

    // Build the full conversation: original messages + assistant tool_calls + tool results
    const messages: ChatMessage[] = [
      ...(input.enableRetry && input.tools?.length
        ? [{ role: 'system' as const, content: FOLLOW_UP_EXECUTION_PROMPT }]
        : []),
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
        toolChoice: retryTools ? (input.toolChoice ?? 'auto') : undefined,
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
      const aggregatedToolResults = [
        ...input.toolResults,
        ...(input.additionalTurns ?? []).flatMap((turn) => turn.toolResults),
      ];

      const latestUserMessage = getLatestUserMessage(input.originalMessages);
      const synthesizedToolCall = retryToolCalls.length === 0 && retryTools
        ? synthesizeDeterministicFollowUpToolCall(latestUserMessage, retryTools)
        : null;
      const effectiveRetryToolCalls = synthesizedToolCall
        ? [{
            id: crypto.randomUUID(),
            name: synthesizedToolCall.name,
            arguments: JSON.stringify(synthesizedToolCall.arguments),
          }]
        : retryToolCalls;

      if (effectiveRetryToolCalls.length > 0 && retryTools) {
        if (shouldStopOnRepeatedToolFailure(effectiveRetryToolCalls, input.additionalTurns)) {
          return {
            content: buildFallbackToolResultContent(input.originalMessages, aggregatedToolResults),
            model: response.model,
            tokensUsed: response.usage.totalTokens,
            promptTokens: response.usage.promptTokens,
            toolCalls: [],
            finishReason: 'stop',
            operationalNotices: buildSuccessfulFailoverNotices(response.failoverSteps),
          };
        }

        console.log(`[llmFollowUpActivity] LLM requested ${effectiveRetryToolCalls.length} retry tool call(s) (#182).`);
        return {
          content: llmContent ?? '',
          model: response.model,
          tokensUsed: response.usage.totalTokens,
          promptTokens: response.usage.promptTokens,
          toolCalls: effectiveRetryToolCalls,
          finishReason: choice.finishReason,
          operationalNotices: buildSuccessfulFailoverNotices(response.failoverSteps),
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
      const content = llmContent
        ? llmContent
        : buildFallbackToolResultContent(input.originalMessages, aggregatedToolResults);

      return {
        content,
        model: response.model,
        tokensUsed: response.usage.totalTokens,
        promptTokens: response.usage.promptTokens,
        toolCalls: [],
        finishReason: choice.finishReason,
        operationalNotices: buildSuccessfulFailoverNotices(response.failoverSteps),
      };
    } catch (err) {
      return {
        content: buildLlmFailureNotice(err),
        model: routing.deploymentName,
        tokensUsed: 0,
        promptTokens: 0,
        toolCalls: [],
        finishReason: 'error',
        operationalNotices: [],
      };
    }
  },
});
