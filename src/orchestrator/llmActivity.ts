// LLM activity — calls Azure AI Foundry and returns the response.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import { FoundryClient } from '../llm/foundryClient.js';
import { getModelRouting, getModelForTask } from '../llm/modelRouter.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import type { PromptResult } from './buildPromptActivity.js';
import type { ChatCompletionResponse, ChatMessage, ContentPart } from '../llm/foundryClient.js';
import { textContent } from '../llm/foundryClient.js';
import { getEnvConfig } from '../config/envConfig.js';
import { trackEvent } from '../observability/telemetry.js';

export interface LlmResult {
  content: string;
  model: string;
  tokensUsed: number;
  /** Prompt tokens sent TO the model (context pressure metric). Fix: #137 */
  promptTokens: number;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string;
}

df.app.activity('llmActivity', {
  handler: async (input: PromptResult & { correlationId?: string; modelOverride?: 'primary' | 'secondary'; imageUrls?: string[] }): Promise<LlmResult> => {
    const routing = getModelRouting();
    const correlationId = input.correlationId ?? crypto.randomUUID();
    const hasImages = input.imageUrls && input.imageUrls.length > 0;

    // Apply model override for /heavy (force primary) or /light (force secondary) commands
    // If images are present and no explicit override, use the vision-capable model (#130)
    let deploymentName: string;
    if (input.modelOverride === 'secondary') {
      deploymentName = getEnvConfig().llmSecondaryModel;
    } else if (input.modelOverride === 'primary') {
      deploymentName = getEnvConfig().llmPrimaryModel;
    } else if (hasImages) {
      deploymentName = getModelForTask('vision');
    } else {
      deploymentName = routing.deploymentName;
    }

    const client = new FoundryClient({ ...routing, deploymentName });

    // Convert PromptResult messages to ChatMessage format
    // If images are present, convert the last user message to multimodal content parts (#130)
    const messages: ChatMessage[] = input.messages.map((m, idx) => {
      if (hasImages && m.role === 'user' && idx === input.messages.length - 1) {
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
    const tools = toolRegistry.toFunctionSchemas();

    trackEvent({ name: 'LlmCallStarted', correlationId, properties: { deployment: deploymentName, toolCount: tools.length } });
    console.log(`[llmActivity] correlationId=${correlationId} deployment=${deploymentName} toolCount=${tools.length} toolNames=${tools.map(t => t.function.name).join(',')}`);

    try {
      const response: ChatCompletionResponse = await client.chatCompletion({
        messages,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: tools.length > 0 ? 'auto' : undefined,
        maxTokens: 4096,
        temperature: 0.7,
        correlationId,
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
      };
    } catch (err) {
      trackEvent({ name: 'LlmCallFailed', correlationId, properties: {
        error: err instanceof Error ? err.message : String(err),
      } });
      console.error(`[llmActivity] LLM call failed: correlationId=${correlationId}`, err);
      // Return a graceful error result — orchestrator handles the failure
      return {
        content: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        model: routing.deploymentName,
        tokensUsed: 0,
        promptTokens: 0,
        toolCalls: [],
        finishReason: 'error',
      };
    }
  },
});
