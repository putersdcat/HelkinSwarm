// Plan activity — lightweight request classification and multi-step decomposition.
// Simple requests skip the LLM planning call (zero overhead).
// Complex requests use the fast model to generate a structured plan.
// Spec ref: 08-Orchestrator-Patterns.md, #320

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../llm/foundryClient.js';
import { getModelForTask, getModelRouting } from '../llm/modelRouter.js';
import { trackEvent } from '../observability/telemetry.js';
import { clearOrchestratorStage, recordOrchestratorStage } from '../observability/orchestratorStageHealth.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequestComplexity = 'simple' | 'compound' | 'complex';
export type StepModel = 'primary' | 'fast' | 'reasoning';

export interface PlanStep {
  order: number;
  description: string;
  toolHint?: string;
  model: StepModel;
  useSubAgent: boolean;
  tokenScope?: string;
  dependsOn?: number[];
}

export interface PlanResult {
  complexity: RequestComplexity;
  /** Null when complexity is 'simple' (planning was skipped). */
  steps: PlanStep[] | null;
  /** Token count used by the planning LLM call (0 for simple). */
  planTokensUsed: number;
  /** Serializable plan artifact for telemetry. */
  planArtifact: string;
}

export interface PlanInput {
  userMessage: string;
  correlationId: string;
  /** Available tool names for domain detection. */
  availableToolNames: string[];
}

// ---------------------------------------------------------------------------
// Classification (no LLM call — pure heuristics)
// ---------------------------------------------------------------------------

/** Detect domains referenced by the user message based on registered tool keywords. */
function detectDomains(message: string, toolNames: string[]): Set<string> {
  const msgLower = message.toLowerCase();
  const domains = new Set<string>();
  for (const name of toolNames) {
    const parts = name.split('_');
    const domain = parts.length > 1 ? parts[0] : 'core';
    // Check if the user message references this domain's keywords
    if (msgLower.includes(domain)) {
      domains.add(domain);
    }
  }
  // Also detect common intent signals
  const domainKeywords: Record<string, string[]> = {
    outlook: ['email', 'mail', 'inbox', 'calendar', 'meeting', 'appointment', 'schedule'],
    teams: ['teams', 'chat', 'message', 'reaction'],
    github: ['github', 'issue', 'repo', 'repository', 'pr', 'pull request', 'commit'],
    web: ['search', 'browse', 'website', 'web', 'url', 'bing'],
  };
  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some(kw => msgLower.includes(kw))) {
      domains.add(domain);
    }
  }
  return domains;
}

/** Count action verbs that suggest multiple steps. */
function countActionSignals(message: string): number {
  const msgLower = message.toLowerCase();
  const connectors = ['then', 'after that', 'and also', 'next', 'finally', 'first', 'second', 'third', 'followed by'];
  let count = 0;
  for (const c of connectors) {
    if (msgLower.includes(c)) count++;
  }
  return count;
}

export function classifyComplexity(message: string, toolNames: string[]): RequestComplexity {
  const domains = detectDomains(message, toolNames);
  const actionSignals = countActionSignals(message);

  // Multi-domain or many sequential actions → complex
  if (domains.size >= 2 && actionSignals >= 1) return 'complex';
  if (actionSignals >= 2) return 'complex';

  // Single domain with some chaining → compound
  if (domains.size >= 1 && actionSignals >= 1) return 'compound';

  // Default: simple
  return 'simple';
}

// ---------------------------------------------------------------------------
// Plan generation (fast model LLM call — compound/complex only)
// ---------------------------------------------------------------------------

const PLAN_SYSTEM_PROMPT = `You are a task planner for an AI assistant that has access to tools.
Given a user request, decompose it into ordered execution steps.

Respond with ONLY a JSON array of step objects. No markdown, no explanation.
Each step: { "order": number, "description": string, "toolHint": string|null, "model": "primary"|"fast"|"reasoning", "useSubAgent": boolean, "tokenScope": "read"|"write"|"delete"|null, "dependsOn": number[] }

Rules:
- Simple data retrieval steps use "fast" model and useSubAgent based on the tool's nature.
- Steps requiring complex reasoning use "reasoning" model.
- Steps that write/create data use tokenScope "write". Deletions use "delete". Reads use "read".
- dependsOn lists the order numbers of steps that must complete first.
- toolHint is the likely tool name (snake_case) or null if uncertain.
- Keep the plan minimal — no unnecessary steps.`;

async function generatePlan(
  message: string,
  complexity: RequestComplexity,
  toolNames: string[],
  correlationId: string,
): Promise<{ steps: PlanStep[]; tokensUsed: number }> {
  const fastModel = getModelForTask('fast');
  const routing = getModelRouting();
  // Override to fast model
  const fastRouting = { ...routing, deploymentName: fastModel };
  const client = new FoundryClient(fastRouting);

  const toolList = toolNames.slice(0, 40).join(', '); // Cap tool list for token budget

  const response = await client.chatCompletion({
    messages: [
      { role: 'system', content: PLAN_SYSTEM_PROMPT },
      { role: 'user', content: `Available tools: ${toolList}\n\nRequest (${complexity}): ${message}` },
    ],
    temperature: 0.1,
    maxTokens: 500,
    correlationId,
  });

  const content = textContent(response.choices[0]?.message?.content);
  const tokensUsed = (response.usage?.totalTokens ?? 0);

  try {
    // Extract JSON array from response (strip any markdown fencing)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { steps: [], tokensUsed };

    const raw = JSON.parse(jsonMatch[0]) as unknown[];
    const steps: PlanStep[] = raw.map((item, idx) => {
      const s = item as Record<string, unknown>;
      return {
        order: typeof s.order === 'number' ? s.order : idx + 1,
        description: String(s.description ?? ''),
        toolHint: typeof s.toolHint === 'string' ? s.toolHint : undefined,
        model: (['primary', 'fast', 'reasoning'].includes(String(s.model)) ? s.model : 'fast') as StepModel,
        useSubAgent: Boolean(s.useSubAgent),
        tokenScope: typeof s.tokenScope === 'string' ? s.tokenScope : undefined,
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.filter((n): n is number => typeof n === 'number') : undefined,
      };
    });
    return { steps, tokensUsed };
  } catch {
    trackEvent({ name: 'PlanParseError', correlationId, properties: { snippet: content.slice(0, 200) } });
    return { steps: [], tokensUsed };
  }
}

// ---------------------------------------------------------------------------
// Durable Activity
// ---------------------------------------------------------------------------

export async function plan(input: PlanInput): Promise<PlanResult> {
  const { userMessage, correlationId, availableToolNames } = input;

  const complexity = classifyComplexity(userMessage, availableToolNames);

  trackEvent({
    name: 'PlanClassification',
    correlationId,
    properties: { complexity, messageLength: userMessage.length },
  });

  // Simple requests: skip planning entirely
  if (complexity === 'simple') {
    return {
      complexity,
      steps: null,
      planTokensUsed: 0,
      planArtifact: JSON.stringify({ complexity, steps: null }),
    };
  }

  // Compound / Complex: generate plan with fast model
  const { steps, tokensUsed } = await generatePlan(
    userMessage,
    complexity,
    availableToolNames,
    correlationId,
  );

  trackEvent({
    name: 'PlanGenerated',
    correlationId,
    properties: {
      complexity,
      stepCount: steps.length,
      tokensUsed,
      models: [...new Set(steps.map(s => s.model))].join(','),
    },
  });

  const result: PlanResult = {
    complexity,
    steps: steps.length > 0 ? steps : null,
    planTokensUsed: tokensUsed,
    planArtifact: JSON.stringify({ complexity, steps }),
  };
  return result;
}

df.app.activity('planActivity', {
  handler: async (input: PlanInput): Promise<PlanResult> => {
    recordOrchestratorStage(input.correlationId, 'plan');
    try {
      return await plan(input);
    } finally {
      clearOrchestratorStage(input.correlationId);
    }
  },
});
