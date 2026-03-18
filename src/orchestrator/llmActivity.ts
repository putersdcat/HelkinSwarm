// LLM activity — calls the language model and returns the response.
// Phase 3 will wire the real Foundry client + model router.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import type { PromptResult } from './buildPromptActivity.js';

export interface LlmResult {
  content: string;
  model: string;
  tokensUsed: number;
  toolCalls: Array<{ name: string; arguments: string }>;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function callLlm(input: PromptResult): LlmResult {
  // Phase 3 stub — returns a structured acknowledgment.
  // The real implementation will route through the LLM client.
  const userMsg = input.messages.find((m) => m.role === 'user');
  const content = `[HelkinSwarm v0.1 — LLM stub] Received your message. The reasoning engine will be wired in Phase 3. Your message: "${userMsg?.content ?? '(empty)'}"`;

  return {
    content,
    model: 'stub-v0.1',
    tokensUsed: estimateTokens(content) + input.estimatedTokens,
    toolCalls: [],
  };
}

df.app.activity('llmActivity', {
  handler: (input: PromptResult): LlmResult => {
    return callLlm(input);
  },
});
