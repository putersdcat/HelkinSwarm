// LLM activity — calls Azure AI Foundry and returns the response.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md

import * as df from 'durable-functions';
import { FoundryClient } from '../llm/foundryClient.js';
import { getModelRouting, getModelForTask } from '../llm/modelRouter.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import type { PromptResult } from './buildPromptActivity.js';
import type { ChatCompletionResponse } from '../llm/foundryClient.js';

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
      ? (process.env['LLM_SECONDARY_MODEL'] ?? getModelForTask('fast'))
      : input.modelOverride === 'primary'
        ? (process.env['LLM_PRIMARY_MODEL'] ?? getModelForTask('reasoning'))
        : routing.deploymentName;

    const client = new FoundryClient({ ...routing, deploymentName });

    // Convert PromptResult messages to ChatMessage format
    const messages = input.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    // Get OpenAI-compatible function schemas from tool registry
    const tools = toolRegistry.toFunctionSchemas();

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

      return {
        content: choice.message.content ?? '',
        model: response.model,
        tokensUsed: response.usage.totalTokens,
        toolCalls,
        finishReason: choice.finishReason,
      };
    } catch (err) {
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
