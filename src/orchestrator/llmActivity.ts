// LLM activity — calls Azure AI Foundry and returns the response.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import {
  buildLlmFailureNotice,
  buildSuccessfulFailoverNotices,
  FoundryClient,
} from '../llm/foundryClient.js';
import {
  classifyRequestedTaskComplexity,
  getDirectChatModelIncompatibilityReason,
  getModelRouting,
  getModelForTask,
} from '../llm/modelRouter.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import type { PromptResult } from './buildPromptActivity.js';
import type { ChatCompletionResponse, ChatMessage, ContentPart } from '../llm/foundryClient.js';
import { textContent } from '../llm/foundryClient.js';
import { trackEvent } from '../observability/telemetry.js';
import { recordSubstage } from '../observability/orchestratorStageHealth.js';

export interface LlmResult {
  content: string;
  model: string;
  tokensUsed: number;
  /** Prompt tokens sent TO the model (context pressure metric). Fix: #137 */
  promptTokens: number;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string;
  operationalNotices: string[];
}

// DIAGNOSTIC (#327): Skip LLM entirely when fast-path is active
const LLM_FAST_PATH = !!(process.env['LLM_FAST_PATH'] ?? '');

df.app.activity('llmActivity', {
  handler: async (input: PromptResult & { correlationId?: string; userId?: string; modelOverride?: string; imageUrls?: string[]; tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>; toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } } }): Promise<LlmResult> => {
    const routing = getModelRouting();
    const correlationId = input.correlationId ?? crypto.randomUUID();
    recordSubstage(correlationId, 'llm', input.userId ?? 'unknown');
    console.log(`[llmActivity] START correlationId=${correlationId} fastPath=${LLM_FAST_PATH}`);

    if (LLM_FAST_PATH) {
      console.log(`[llmActivity] FAST PATH — returning hardcoded response`);
      return {
        content: 'ALIVE — diagnostic fast-path active (no LLM call)',
        model: routing.deploymentName,
        tokensUsed: 0,
        promptTokens: 0,
        toolCalls: [],
        finishReason: 'stop',
        operationalNotices: ['[diag] LLM_FAST_PATH=1 — no actual LLM call was made'],
      };
    }
    const hasImages = input.imageUrls && input.imageUrls.length > 0;

    // Apply model override for /heavy (force reasoning) or /light (force fast) commands
    // If images are present and no explicit override, use the vision-capable model (#130)
    let deploymentName: string;
    let isReasoning = routing.isReasoning;
    if (input.modelOverride === 'secondary') {
      deploymentName = routing.lane.secondary;
      isReasoning = false;
    } else if (input.modelOverride === 'primary') {
      // /heavy → use the reasoning model from the active lane (#185)
      deploymentName = routing.lane.reasoning ?? routing.lane.primary;
      isReasoning = true;
    } else if (input.modelOverride && input.modelOverride !== 'primary' && input.modelOverride !== 'secondary') {
      // Direct deployment name override via /model command (#217)
      const incompatibilityReason = getDirectChatModelIncompatibilityReason(input.modelOverride);
      if (incompatibilityReason) {
        const message = `LLM call skipped: direct model override "${input.modelOverride}" is unsupported because it ${incompatibilityReason}.`;
        trackEvent({
          name: 'LlmCallFailed',
          correlationId,
          properties: {
            error: message,
            deployment: input.modelOverride,
          },
        });
        return {
          content: message,
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
    } else if (hasImages) {
      deploymentName = getModelForTask('vision');
    } else {
      deploymentName = routing.deploymentName;
    }

    const client = new FoundryClient({ ...routing, deploymentName, isReasoning });

    // Pre-flight: reject messages with empty content — LLM APIs return 400 for these
    const validMessages = input.messages.filter((m) => {
      const c = typeof m.content === 'string' ? m.content.trim() : '';
      if (c.length === 0) {
        console.warn(`[llmActivity] Dropping message with empty content: role=${m.role}`);
        return false;
      }
      return true;
    });

    // Convert PromptResult messages to ChatMessage format
    // If images are present, convert the last user message to multimodal content parts (#130)
    const messages: ChatMessage[] = validMessages.map((m, idx) => {
      if (hasImages && m.role === 'user' && idx === validMessages.length - 1) {
        const parts: ContentPart[] = [{ type: 'text', text: m.content }];
        for (const url of input.imageUrls!) {
          parts.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
        }
        return { role: m.role as 'system' | 'user' | 'assistant', content: parts };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      };
    });

    // Get OpenAI-compatible function schemas from tool registry
    const tools = input.tools ?? toolRegistry.toFunctionSchemas();
    const requestedTaskComplexity = classifyRequestedTaskComplexity({
      userMessage: input.userMessage,
      modelOverride: input.modelOverride,
      runtimeAssetCount: input.imageUrls?.length,
      hasQuotedContext: false,
      hasDevLoopContext: false,
    });

    trackEvent({ name: 'LlmCallStarted', correlationId, properties: { deployment: deploymentName, toolCount: tools.length } });
    console.log(`[llmActivity] correlationId=${correlationId} deployment=${deploymentName} toolCount=${tools.length} toolNames=${tools.map(t => t.function.name).join(',')}`);

    try {
      const response: ChatCompletionResponse = await client.chatCompletion({
        messages,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: tools.length > 0 ? (input.toolChoice ?? 'auto') : undefined,
        maxTokens: 4096,
        temperature: 0.7,
        correlationId,
        requestedTaskComplexity,
      });

      const choice = response.choices[0];

      const toolCalls =
        choice.message.toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })) ?? [];

      trackEvent({ name: 'LlmCallCompleted', correlationId, properties: {
        model: response.model,
        finishReason: choice.finishReason,
        contentLen: (choice.message.content ?? '').length,
        toolCallCount: toolCalls.length,
        tokensUsed: response.usage.totalTokens,
      } });
      console.log(`[llmActivity] LLM responded: model=${response.model} finishReason=${choice.finishReason} contentLen=${(choice.message.content ?? '').length} toolCalls=${toolCalls.length} tokensUsed=${response.usage.totalTokens}`);

      return {
        content: textContent(choice.message.content),
        model: response.model,
        tokensUsed: response.usage.totalTokens,
        promptTokens: response.usage.promptTokens,
        toolCalls,
        finishReason: choice.finishReason,
        operationalNotices: buildSuccessfulFailoverNotices(response.failoverSteps),
      };
    } catch (err) {
      const notice = buildLlmFailureNotice(err);
      trackEvent({ name: 'LlmCallFailed', correlationId, properties: {
        error: err instanceof Error ? err.message : String(err),
        userNotice: notice,
      } });
      console.error(`[llmActivity] LLM call failed: correlationId=${correlationId}`, err);
      // Return a graceful operational notice instead of leaking raw provider errors.
      return {
        content: notice,
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
