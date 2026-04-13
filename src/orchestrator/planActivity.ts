// Plan activity — lightweight request classification and multi-step decomposition.
// Simple requests skip the LLM planning call (zero overhead).
// Complex requests use the fast model to generate a structured plan.
// Spec ref: 08-Orchestrator-Patterns.md, #320

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../llm/foundryClient.js';
import { getModelForTask, getModelRouting } from '../llm/modelRouter.js';
import { trackEvent } from '../observability/telemetry.js';
import { recordSubstage } from '../observability/orchestratorStageHealth.js';
import { computeSwarmEligibilityScore } from './swarm/swarmTypes.js';

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
  /** Exact provider-reported cost for the planning call when available (OpenRouter). */
  planProviderCost?: number;
  planProviderCostUnit?: 'credits';
  planProviderCostDetails?: Record<string, number>;
  /** Serializable plan artifact for telemetry. */
  planArtifact: string;
  /**
   * Whether the swarm feature flag is enabled.
   * Read inside the activity (env-read safe) and passed to the orchestrator
   * generator so the swarm branch decision is deterministic during replay.
   */
  swarmEnabled: boolean;
  /** Numeric swarm eligibility score for decomposer context (#640). */
  swarmEligibilityScore: number;
}

export interface PlanInput {
  userMessage: string;
  correlationId: string;
  userId: string;
  /** Available tool names for domain detection. */
  availableToolNames: string[];
}

// ---------------------------------------------------------------------------
// Classification (no LLM call — structural message analysis only)
// ---------------------------------------------------------------------------
// Removed in #324: detectDomains() and domainKeywords map.
// Classification must NOT sniff tool names, domain prefixes, or hard-coded keywords.
// It uses only structural signals (sequential connectors, sentence count) to decide
// whether the request needs an LLM planning call.

/** Count sequential/chaining connectors that suggest multi-step intent. */
function countActionSignals(message: string): number {
  const msgLower = message.toLowerCase();
  const connectors = ['then', 'after that', 'and also', 'next', 'finally', 'first', 'second', 'third', 'followed by'];
  let count = 0;
  for (const c of connectors) {
    if (msgLower.includes(c)) count++;
  }
  return count;
}

export function classifyComplexity(message: string): RequestComplexity {
  const connectorCount = countActionSignals(message);

  // Multiple sequential/chaining signals → complex
  if (connectorCount >= 2) return 'complex';

  // At least one chaining signal → compound
  if (connectorCount >= 1) return 'compound';

  // Default: simple (single question, greeting, etc.)
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
): Promise<{
  steps: PlanStep[];
  tokensUsed: number;
  providerCost?: number;
  providerCostUnit?: 'credits';
  providerCostDetails?: Record<string, number>;
}> {
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
  const providerCost = response.usage?.providerCost;
  const providerCostUnit = response.usage?.providerCostUnit;
  const providerCostDetails = response.usage?.providerCostDetails;

  try {
    // Extract JSON array from response (strip any markdown fencing)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return { steps: [], tokensUsed, providerCost, providerCostUnit, providerCostDetails };
    }

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
    return { steps, tokensUsed, providerCost, providerCostUnit, providerCostDetails };
  } catch {
    trackEvent({ name: 'PlanParseError', correlationId, properties: { snippet: content.slice(0, 200) } });
    return { steps: [], tokensUsed, providerCost, providerCostUnit, providerCostDetails };
  }
}

// ---------------------------------------------------------------------------
// Durable Activity
// ---------------------------------------------------------------------------

export async function plan(input: PlanInput): Promise<PlanResult> {
  const { userMessage, correlationId, availableToolNames } = input;

  const complexity = classifyComplexity(userMessage);

  trackEvent({
    name: 'PlanClassification',
    correlationId,
    properties: { complexity, messageLength: userMessage.length },
  });

  const swarmEligibilityScore = computeSwarmEligibilityScore(userMessage);

  // Simple requests: skip planning entirely
  if (complexity === 'simple') {
    return {
      complexity,
      steps: null,
      planTokensUsed: 0,
      planProviderCost: undefined,
      planProviderCostUnit: undefined,
      planProviderCostDetails: undefined,
      planArtifact: JSON.stringify({ complexity, steps: null }),
      swarmEnabled: process.env['SWARM_ENABLED']?.toLowerCase() === 'true',
      swarmEligibilityScore,
    };
  }

  // Compound / Complex: generate plan with fast model
  const { steps, tokensUsed, providerCost, providerCostUnit, providerCostDetails } = await generatePlan(
    userMessage,
    complexity,
    availableToolNames,
    correlationId,
  );

  trackEvent({
    name: 'OrchestratorPlanCreated',
    correlationId,
    userId: input.userId,
    properties: {
      complexity,
      stepCount: steps.length,
      modelPairings: steps.map((step) => `${step.order}:${step.model}`).join(','),
      subAgentCount: steps.filter((step) => step.useSubAgent).length,
    },
  });

  trackEvent({
    name: 'PlanGenerated',
    correlationId,
    userId: input.userId,
    properties: {
      complexity,
      stepCount: steps.length,
      tokensUsed,
      ...(providerCost !== undefined
        ? {
            providerCost,
            providerCostUnit: providerCostUnit ?? 'credits',
          }
        : {}),
      models: [...new Set(steps.map(s => s.model))].join(','),
    },
  });

  const result: PlanResult = {
    complexity,
    steps: steps.length > 0 ? steps : null,
    planTokensUsed: tokensUsed,
    planProviderCost: providerCost,
    planProviderCostUnit: providerCostUnit,
    planProviderCostDetails: providerCostDetails,
    planArtifact: JSON.stringify({ complexity, steps }),
    swarmEnabled: process.env['SWARM_ENABLED']?.toLowerCase() === 'true',
    swarmEligibilityScore,
  };
  return result;
}

df.app.activity('planActivity', {
  handler: async (input: PlanInput): Promise<PlanResult> => {
    recordSubstage(input.correlationId, 'plan', input.userId);
    return await plan(input);
  },
});
