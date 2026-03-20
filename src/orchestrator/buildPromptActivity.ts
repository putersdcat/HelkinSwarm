// Build Prompt activity — assembles the full prompt for the LLM call.
// Includes persona, conversation summary, current message, and tool list.
// Phase 4 will add just-in-time skill memory (0i) and Hydra-Net (0k).
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OverseerState } from './stateManager.js';
import { toolRegistry } from '../tools/toolRegistry.js';

export interface BuildPromptInput {
  state: OverseerState;
  userMessage: string;
}

export interface PromptResult {
  systemPrompt: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  estimatedTokens: number;
}

// Cache persona text after first load
let cachedPersona: string | null = null;

async function loadPersona(): Promise<string> {
  if (cachedPersona) return cachedPersona;
  try {
    cachedPersona = await readFile(
      join(process.cwd(), 'src', 'persona', 'dronePersona.md'),
      'utf-8',
    );
  } catch {
    cachedPersona = 'You are HelkinSwarm — a personal sovereign AI copilot. You are direct, capable, and act with precision.';
  }
  return cachedPersona;
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

export async function buildPrompt(input: BuildPromptInput): Promise<PromptResult> {
  const { state, userMessage } = input;

  const persona = await loadPersona();

  // Build tool summary for the system prompt
  const tools = toolRegistry.getAll();
  const toolSummary = tools.length > 0
    ? `Available tools: ${tools.map((t) => `${t.name} (${t.description})`).join('; ')}`
    : '';

  const systemPrompt = [
    persona,
    state.euResidencyMode ? 'EU Residency Mode is ACTIVE — use only EU-compliant models.' : '',
    state.summary ? `Previous conversation summary:\n${state.summary}` : '',
    toolSummary,
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
  handler: async (input: BuildPromptInput): Promise<PromptResult> => {
    return buildPrompt(input);
  },
});
