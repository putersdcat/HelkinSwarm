// Build Prompt activity — assembles the full prompt for the LLM call.
// Includes persona, conversation summary, current message, tool list, and recalled memory.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OverseerState } from './stateManager.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { getUserProfile, profileToPromptFragment } from '../memory/userProfile.js';
import { getModelRouting } from '../llm/modelRouter.js';
import { MemoryManager } from '../memory/memoryManager.js';
import { buildPriorsPromptFragment } from '../persona/operatorDomainPriors.js';
import { buildDevLoopSystemBlock } from '../devloop/sessionContext.js';
import type { DevLoopContext } from '../devloop/radioProtocol.js';
import type { QuotedContext } from '../bot/quotedContext.js';
import { trackEvent } from '../observability/telemetry.js';

export interface BuildPromptInput {
  state: OverseerState;
  userMessage: string;
  /** Parsed DevLoop protocol context (#147) */
  devLoopContext?: DevLoopContext;
  /** Structured quoted-reply context from Teams reply-with-quote (#278) */
  quotedContext?: QuotedContext;
  /** Correlation ID for tracing (#269). */
  correlationId?: string;
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

  // Build tool summary for the system prompt — safety-filtered (#210)
  const tools = toolRegistry.getSafetyFiltered();
  const toolSummary = tools.length > 0
    ? `Available tools: ${tools.map((t) => `${t.name} (${t.description})`).join('; ')}`
    : '';

  // Inject model identity so the LLM knows what it's running on (#131)
  const routing = getModelRouting();
  const modelIdentity = `You are running on model deployment: ${routing.deploymentName} (lane: ${routing.laneName}, primary: ${routing.lane.primary}, secondary: ${routing.lane.secondary}).`;

  // Recall relevant memories for context injection (#134)
  // JIT injection: also recall skill-specific memories based on detected domains (#66)
  let recalledMemory = '';
  try {
    const mm = new MemoryManager(state.userId);

    // General memory recall (cross-skill)
    const memories = await mm.recall(userMessage, { topK: 3, minScore: 0.7 });

    // Skill-scoped JIT injection: detect active skill domains from tool registry
    // and pull skill-specific memories for relevant domains
    const skillDomains = [...new Set(
      toolRegistry.getSafetyFiltered()
        .map((t) => t.handlerModule)
        .filter(Boolean)
        .map((m) => m!.replace('skills/', '')),
    )];

    const skillMemories = skillDomains.length > 0
      ? await mm.recallForSkills(userMessage, skillDomains, { topK: 2, minScore: 0.65 })
      : new Map<string, never[]>();

    // Format memories with skill attribution
    const parts: string[] = [];
    if (memories.length > 0) {
      parts.push(memories.map((m) => `- ${m.content}`).join('\n'));
    }
    for (const [skillId, mems] of skillMemories) {
      if (mems.length > 0) {
        parts.push(`[${skillId} skill context]\n${mems.map((m) => `- ${m.content}`).join('\n')}`);
      }
    }
    if (parts.length > 0) {
      recalledMemory = `Relevant context from past interactions:\n${parts.join('\n')}`;
    }
  } catch {
    // Memory recall unavailable — proceed without
  }

  // Inject DevLoop session context when in a DevLoop session (#147)
  const devLoopBlock = input.devLoopContext?.isDevLoop
    ? buildDevLoopSystemBlock(input.devLoopContext)
    : '';

  // In DevLoop sessions, suppress user preferences and onboarding — they leak
  // user-specific context (e.g. "Mr. Anderson" addressing) into system channels (#148).
  const isDevLoop = !!input.devLoopContext?.isDevLoop;

  const systemPrompt = [
    persona,
    modelIdentity,
    buildPriorsPromptFragment(),
    devLoopBlock,
    !isDevLoop && preferencesFragment ? `User preferences: ${preferencesFragment}` : '',
    !isDevLoop ? onboardingInstructions : '',
    !isDevLoop ? recalledMemory : '',
    state.euResidencyMode ? 'EU Residency Mode is ACTIVE — use only EU-compliant models.' : '',
    state.summary ? `Previous conversation summary:\n${state.summary}` : '',
    toolSummary,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: PromptResult['messages'] = [
    { role: 'system' as const, content: systemPrompt },
  ];

  // Inject recent conversation history for multi-turn coherence (#203)
  if (state.recentHistory && state.recentHistory.length > 0) {
    let skippedCount = 0;
    for (const turn of state.recentHistory) {
      const c = typeof turn.content === 'string' ? turn.content.trim() : '';
      if (c.length === 0) {
        skippedCount++;
        continue; // Skip entries with empty/null/undefined content — LLM APIs reject them
      }
      messages.push({ role: turn.role as 'user' | 'assistant', content: turn.content });
    }
    if (skippedCount > 0) {
      console.warn(`[buildPrompt] Skipped ${skippedCount} recentHistory entries with empty content`);
    }
  }

  // Inject structured quoted context before the user message (#278)
  if (input.quotedContext) {
    const q = input.quotedContext;
    const confidence = q.mayBeTruncated ? ' (may be truncated)' : '';
    const quoteBlock = `[Replying to a previous message${confidence}]\n"${q.text}"`;
    messages.push({ role: 'user' as const, content: quoteBlock });
  }

  messages.push({ role: 'user' as const, content: userMessage });

  const totalText = messages.map((m) => m.content).join('');
  const estimatedTokens = estimateTokens(totalText);

  if (input.correlationId) {
    trackEvent({ name: 'PromptBuilt', correlationId: input.correlationId, userId: input.state.userId, properties: { estimatedTokens: String(estimatedTokens), messageCount: String(messages.length) } });
  }

  return { systemPrompt, messages, estimatedTokens };
}

// Durable Functions activity registration
df.app.activity('buildPromptActivity', {
  handler: async (input: BuildPromptInput): Promise<PromptResult> => {
    return buildPrompt(input);
  },
});
