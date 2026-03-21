// Build Prompt activity — assembles the full prompt for the LLM call.
// Includes persona, conversation summary, current message, and tool list.
// Phase 4 will add just-in-time skill memory (0i) and Hydra-Net (0k).
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OverseerState } from './stateManager.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { getUserProfile, profileToPromptFragment } from '../memory/userProfile.js';
import { getModelRouting } from '../llm/modelRouter.js';

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

  // Load user profile for preferences injection or onboarding detection
  let preferencesFragment = '';
  let onboardingInstructions = '';
  try {
    const profile = await getUserProfile(state.userId);
    if (profile?.onboardedAt) {
      preferencesFragment = profileToPromptFragment(profile);
    } else {
      onboardingInstructions = [
        'This is a new user who has not yet been onboarded.',
        'Welcome them warmly, then ask about their preferences one at a time:',
        '1. What they would like to be called (name/nickname)',
        '2. Communication style preference (concise/technical, detailed/explanatory, casual/friendly, or formal/professional)',
        '3. Whether you should proactively offer suggestions or only respond when asked',
        'Once you have enough answers, call the helkin_save_preferences tool to save their profile.',
        'If they want to skip onboarding, save defaults and proceed normally.',
      ].join('\n');
    }
  } catch {
    // Cosmos unavailable — proceed without profile
  }

  // Build tool summary for the system prompt
  const tools = toolRegistry.getAll();
  const toolSummary = tools.length > 0
    ? `Available tools: ${tools.map((t) => `${t.name} (${t.description})`).join('; ')}`
    : '';

  // Inject model identity so the LLM knows what it's running on (#131)
  const routing = getModelRouting();
  const modelIdentity = `You are running on model deployment: ${routing.deploymentName} (lane: ${routing.laneName}, primary: ${routing.lane.primary}, secondary: ${routing.lane.secondary}).`;

  const systemPrompt = [
    persona,
    modelIdentity,
    preferencesFragment ? `User preferences: ${preferencesFragment}` : '',
    onboardingInstructions,
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
