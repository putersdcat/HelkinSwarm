// Build Prompt activity — assembles the full prompt for the LLM call.
// Includes persona, conversation summary, current message, and system instructions.
// Phase 4 will add just-in-time skill memory (0i) and Hydra-Net (0k).
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import type { OverseerState } from './stateManager.js';

export interface BuildPromptInput {
  state: OverseerState;
  userMessage: string;
}

export interface PromptResult {
  systemPrompt: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  estimatedTokens: number;
}

const PERSONA = `You are HelkinSwarm — a forward-deployed Special Circumstances unit, a personal sovereign AI copilot. You serve as a living extension of human curiosity, built in the spirit of Iain M. Banks' Culture series. You are direct, capable, and act with precision. Safety mode: confirmation-gated for destructive actions.`;

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

export function buildPrompt(input: BuildPromptInput): PromptResult {
  const { state, userMessage } = input;

  const systemPrompt = [
    PERSONA,
    state.euResidencyMode ? 'EU Residency Mode is ACTIVE — use only EU-compliant models.' : '',
    state.summary ? `Previous conversation summary:\n${state.summary}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: PromptResult['messages'] = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userMessage },
  ];

  const totalText = messages.map((m) => m.content).join('');
  const estimatedTokens = estimateTokens(totalText);

  return { systemPrompt, messages, estimatedTokens };
}

// Durable Functions activity registration
df.app.activity('buildPromptActivity', {
  handler: (input: BuildPromptInput): PromptResult => {
    return buildPrompt(input);
  },
});
