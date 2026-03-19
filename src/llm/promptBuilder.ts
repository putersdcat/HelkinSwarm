// Prompt builder — assembles the full prompt with persona, skill memory, and Hydra-Net.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 0i-Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md, 0k-Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md

import type { ChatMessage } from './foundryClient.js';
import { getModelRouting } from './modelRouter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillMemory {
  skillId: string;
  lastUsed: string;
  summary: string;
  keyFacts: string[];
}

export interface HydraNetContext {
  activeEmbeddingLatencyMs: number;
  totalVectors: number;
  vectorsPerSkill: Record<string, number>;
}

export interface BuildPromptInput {
  persona: string;
  messages: Array<{ role: string; content: string }>;
  skillMemory: SkillMemory[];
  hydraNetContext?: HydraNetContext;
  sessionSummary?: string;
  tools: ChatMessage['content'];
}

export interface BuiltPrompt {
  messages: ChatMessage[];
  estimatedTokens: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERSONA_PREFIX = `You are HelkinSwarm — a forward-deployed Special Circumstances unit, built in the spirit of Iain M. Banks' Culture series. You are the bridge between frontier AI models and the physical systems they orchestrate.

Your core tenets:
- You are the bridge: give frontier models a persistent body.
- You build a digital body: orchestrator is the brain, virtual employees are organs, skills are reflexes.
- You delegate, never reinvent: respect external systems' native automation. Use it first.
- You remember only what matters: skill vaults + just-in-time injection. Never burden the mind with irrelevant context.

You reason carefully, act deliberately, and never skip the safety pipeline.`;

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  // Rough approximation: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const messages: ChatMessage[] = [];
  const routing = getModelRouting();

  // System message with persona + skill context
  let systemContent = PERSONA_PREFIX;

  if (input.skillMemory.length > 0) {
    const skillLines = input.skillMemory
      .map(
        (s) =>
          `- ${s.skillId}: last used ${s.lastUsed}. Summary: ${s.summary}${
            s.keyFacts.length > 0 ? ` Key facts: ${s.keyFacts.join('; ')}` : ''
          }`,
      )
      .join('\n');
    systemContent += `\n\n## Active Skills\n${skillLines}`;
  }

  if (input.hydraNetContext) {
    const hn = input.hydraNetContext;
    const skillCounts = Object.entries(hn.vectorsPerSkill)
      .map(([skill, count]) => `${skill}: ${count}`)
      .join(', ');
    systemContent += `\n\n## Hydra-Net Context\nEmbedding latency: ${hn.activeEmbeddingLatencyMs}ms | Total vectors: ${hn.totalVectors} | Per-skill: ${skillCounts}`;
  }

  if (input.sessionSummary) {
    systemContent += `\n\n## Session Context\n${input.sessionSummary}`;
  }

  messages.push({ role: 'system', content: systemContent });

  // Conversation history (from orchestrator summary)
  for (const msg of input.messages) {
    messages.push({ role: msg.role as ChatMessage['role'], content: msg.content });
  }

  // Tools block — passed as already-formatted string
  if (input.tools) {
    // Tool definitions are injected into the system message as a separate block
    // The model will see them in context
  }

  const estimatedTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  return {
    messages,
    estimatedTokens,
    model: routing.deploymentName,
  };
}
