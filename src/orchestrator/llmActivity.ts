// LLM activity — calls Azure AI Foundry and returns the response.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import { FoundryClient } from '../llm/foundryClient.js';
import { getModelRouting } from '../llm/modelRouter.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import type { PromptResult } from './buildPromptActivity.js';
import type { ChatCompletionResponse } from '../llm/foundryClient.js';
import { getEnvConfig } from '../config/envConfig.js';

export interface LlmResult {
  content: string;
  model: string;
  tokensUsed: number;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string;
}

df.app.activity('llmActivity', {
  handler: async (input: PromptResult & { correlationId?: string; modelOverride?: 'primary' | 'secondary' }): Promise<LlmResult> => {
    const routing = getModelRouting();
    const correlationId = input.correlationId ?? crypto.randomUUID();

    // Apply model override for /heavy (force primary) or /light (force secondary) commands
    const deploymentName = input.modelOverride === 'secondary'
      ? (getEnvConfig().llmSecondaryModel)
      : input.modelOverride === 'primary'
        ? (getEnvConfig().llmPrimaryModel)
        : routing.deploymentName;

    const client = new FoundryClient({ ...routing, deploymentName });

    // Convert PromptResult messages to ChatMessage format
    const messages = input.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    // Get OpenAI-compatible function schemas from tool registry
    const tools = toolRegistry.toFunctionSchemas();

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

      console.log(`[llmActivity] LLM responded: model=${response.model} finishReason=${choice.finishReason} contentLen=${(choice.message.content ?? '').length} toolCalls=${toolCalls.length} tokensUsed=${response.usage.totalTokens}`);

      return {
        content: choice.message.content ?? '',
        model: response.model,
        tokensUsed: response.usage.totalTokens,
        toolCalls,
        finishReason: choice.finishReason,
      };
    } catch (err) {
      console.error(`[llmActivity] LLM call failed: correlationId=${correlationId}`, err);
      // Return a graceful error result — orchestrator handles the failure
      return {
        content: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        model: routing.deploymentName,
        tokensUsed: 0,
        toolCalls: [],
        finishReason: 'error',
      };
    }
  },
});
