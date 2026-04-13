// Model router — selects the best model based on EU residency toggle.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 0b-Model-Specific-Tool-Presentation.md

import { getEnvConfig } from '../config/envConfig.js';
import { isModelDegraded } from './modelCircuitBreaker.js';
import { isModelTrackedDown } from './llmHealthTracker.js';

// ---------------------------------------------------------------------------
// Model lanes
// ---------------------------------------------------------------------------

export interface ModelLane {
  /** Primary reasoning model */
  primary: string;
  /** Secondary fast model for sub-agents and non-reasoning tasks */
  secondary: string;
  /** Embedding model for vector storage */
  embedding: string;
  /** Reasoning model variant (if supported) */
  reasoning?: string;
  /** Vision-capable model for image processing (#130) */
  vision?: string;
}

const GLOBAL_LANE_DEFAULTS: ModelLane = {
  primary: 'grok-4-1-fast-non-reasoning',
  secondary: 'o4-mini',
  embedding: 'text-embedding-3-large',
  // grok-4-1-fast-reasoning consistently times out (>55s); tracked in #128
  reasoning: 'o4-mini',
  vision: 'o4-mini', // vision-capable fallback
};

const EU_LANE_DEFAULTS: ModelLane = {
  // DataZoneStandard deployments only — data stays within EU boundary.
  // Grok models are already DataZoneStandard in Bicep.
  primary: 'grok-4-1-fast-reasoning',
  secondary: 'grok-4-1-fast-non-reasoning',
  embedding: 'text-embedding-3-large', // GlobalStandard — no DZ embedding exists yet
  reasoning: 'grok-4-1-fast-reasoning',
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface ModelRouting {
  /** The resolved model lane */
  lane: ModelLane;
  /** Which lane we are using (for telemetry) */
  laneName: 'global' | 'eu' | 'openrouter';
  /** Whether this is a reasoning model */
  isReasoning: boolean;
  /** Deployment name in Azure AI Foundry (or OpenRouter model ID) */
  deploymentName: string;
  /** API base URL */
  apiBase: string;
  /** Whether OBO token flow is required (false for OpenRouter) */
  usesObo: boolean;
}

export type ModelCapacityLevel = 'high' | 'medium' | 'low';
export type ModelImpairmentProtocol = 'full-capability' | 'prefer-simple-work' | 'defer-heavy-work';

export interface ModelCapacityProfile {
  modelId: string;
  capacityLevel: ModelCapacityLevel;
  defaultReasoning: boolean;
  suitableFor: string[];
  unsuitableFor: string[];
  impairmentProtocol: ModelImpairmentProtocol;
}

export interface ConsciousLaneAssessment {
  deploymentName: string;
  capacityProfile: ModelCapacityProfile;
  isImpaired: boolean;
  summary: string;
}

export type RequestedTaskComplexity = 'simple' | 'compound' | 'complex';

export interface FallbackChainOptions {
  requestedTaskComplexity?: RequestedTaskComplexity;
}

export interface RequestedTaskComplexityInput {
  userMessage: string;
  modelOverride?: string;
  runtimeAssetCount?: number;
  hasQuotedContext?: boolean;
  hasDevLoopContext?: boolean;
}

function isQuotedSkillProofPrompt(normalizedUserMessage: string): boolean {
  const hasProofIntent = /(simple|quick|safe)?\s*(functional test|smoke test|test|verify|prove|demonstrate)/.test(normalizedUserMessage);
  const hasSkillReference = /\b(skill|tool|this|that|it)\b/.test(normalizedUserMessage);
  const asksForResults = /\b(output|show|return)\b.*\bresults?\b/.test(normalizedUserMessage);

  return hasProofIntent && (hasSkillReference || asksForResults);
}

const MODEL_CAPACITY_PROFILES: readonly ModelCapacityProfile[] = [
  {
    modelId: 'grok-4-1-fast-reasoning',
    capacityLevel: 'high',
    defaultReasoning: true,
    suitableFor: ['orchestration', 'heavy-planning', 'tool-selection'],
    unsuitableFor: ['simple-sub-session'],
    impairmentProtocol: 'full-capability',
  },
  {
    modelId: 'o4-mini',
    capacityLevel: 'high',
    defaultReasoning: true,
    suitableFor: ['orchestration', 'heavy-planning', 'tool-selection'],
    unsuitableFor: ['fast-response'],
    impairmentProtocol: 'full-capability',
  },
  {
    modelId: 'grok-4-1-fast-non-reasoning',
    capacityLevel: 'medium',
    defaultReasoning: false,
    suitableFor: ['orchestration', 'tool-selection', 'fast-response'],
    unsuitableFor: ['heavy-planning'],
    impairmentProtocol: 'prefer-simple-work',
  },
  {
    modelId: 'DeepSeek-V3.2',
    capacityLevel: 'medium',
    defaultReasoning: false,
    suitableFor: ['fast-response', 'simple-sub-session'],
    unsuitableFor: ['heavy-planning'],
    impairmentProtocol: 'prefer-simple-work',
  },
  {
    modelId: 'FW-Kimi-K2.5',
    capacityLevel: 'medium',
    defaultReasoning: false,
    suitableFor: ['fast-response', 'simple-sub-session'],
    unsuitableFor: ['heavy-planning'],
    impairmentProtocol: 'prefer-simple-work',
  },
  {
    modelId: 'o4-mini',
    capacityLevel: 'low',
    defaultReasoning: false,
    suitableFor: ['simple-sub-session', 'fast-response', 'vision'],
    unsuitableFor: ['orchestration', 'heavy-planning'],
    impairmentProtocol: 'defer-heavy-work',
  },
];

const DIRECT_CHAT_MODEL_OVERRIDES = [
  'grok-4-1-fast-non-reasoning',
  'grok-4-1-fast-reasoning',
  'o4-mini',
  'o4-mini',
  'DeepSeek-V3.2',
  'FW-MiniMax-M2.5',
  'FW-Kimi-K2.5',
] as const;

const DIRECT_CHAT_MODEL_OVERRIDE_SET = new Set<string>(DIRECT_CHAT_MODEL_OVERRIDES);

const CHAT_INCOMPATIBLE_MODEL_REASONS: Record<string, string> = {
  'gpt-5.1-codex-mini': 'does not support the chat completions API (codex/completions-only deployment)',
};

function isEuResidencyModeEnabledForDirectOverrides(): boolean {
  return process.env['EU_RESIDENCY_MODE']?.toLowerCase() === 'true';
}

function getGlobalLane(config: ReturnType<typeof getEnvConfig>): ModelLane {
  return {
    primary: config.llmPrimaryModel,
    secondary: config.llmSecondaryModel,
    embedding: config.llmEmbeddingModel,
    reasoning: GLOBAL_LANE_DEFAULTS.reasoning,
    vision: config.llmVisionModel || GLOBAL_LANE_DEFAULTS.vision,
  };
}

function getEuLane(config: ReturnType<typeof getEnvConfig>): ModelLane {
  return {
    primary: EU_LANE_DEFAULTS.primary,
    secondary: config.llmSecondaryModel || EU_LANE_DEFAULTS.secondary,
    embedding: config.llmEmbeddingModel,
    reasoning: EU_LANE_DEFAULTS.reasoning,
    vision: config.llmVisionModel || GLOBAL_LANE_DEFAULTS.vision,
  };
}

function isReasoningDeploymentName(deploymentName: string, lane: ModelLane): boolean {
  return deploymentName === lane.reasoning || isReasoningModel(deploymentName);
}

/**
 * Standalone check: is this deployment name a reasoning-class model?
 * Excludes explicit 'non-reasoning' variants.
 */
export function isReasoningModel(deploymentName: string): boolean {
  if (deploymentName.includes('non-reasoning')) return false;
  return deploymentName.includes('reasoning') || deploymentName.startsWith('o');
}

function createRoutingEntry(base: ModelRouting, deploymentName: string): ModelRouting {
  return {
    ...base,
    deploymentName,
    isReasoning: isReasoningDeploymentName(deploymentName, base.lane),
  };
}

function findCapacityProfile(deploymentName: string): ModelCapacityProfile | undefined {
  const normalized = deploymentName.toLowerCase();
  return [...MODEL_CAPACITY_PROFILES]
    .sort((a, b) => b.modelId.length - a.modelId.length)
    .find((profile) => normalized === profile.modelId.toLowerCase() || normalized.startsWith(`${profile.modelId.toLowerCase()}-`));
}

function isUnavailableForConsciousRouting(deploymentName: string | undefined): boolean {
  if (!deploymentName) {
    return true;
  }

  return isModelDegraded(deploymentName) || isModelTrackedDown(deploymentName);
}

function selectRestoredConsciousLaneDeployment(lane: ModelLane, currentDeploymentName: string): string {
  const currentProfile = getModelCapacityProfile(currentDeploymentName);
  if (currentProfile.capacityLevel !== 'low' || !isUnavailableForConsciousRouting(currentDeploymentName)) {
    return currentDeploymentName;
  }

  const restorationCandidates = [lane.reasoning, lane.primary]
    .filter((deploymentName): deploymentName is string => !!deploymentName)
    .filter((deploymentName) => deploymentName !== currentDeploymentName)
    .filter((deploymentName) => !isUnavailableForConsciousRouting(deploymentName));

  const rankedCandidates = restorationCandidates
    .map((deploymentName) => ({
      deploymentName,
      capacityLevel: getModelCapacityProfile(deploymentName).capacityLevel,
    }))
    .sort((left, right) => {
      const rank = (capacityLevel: ModelCapacityLevel): number => {
        switch (capacityLevel) {
          case 'high': return 0;
          case 'medium': return 1;
          case 'low': return 2;
        }
      };

      return rank(left.capacityLevel) - rank(right.capacityLevel);
    });

  return rankedCandidates[0]?.deploymentName ?? currentDeploymentName;
}

function getAzureRouting(config: ReturnType<typeof getEnvConfig>): ModelRouting {
  if (config.euResidencyMode) {
    const lane = getEuLane(config);
    return {
      lane,
      laneName: 'eu',
      isReasoning: true,
      deploymentName: lane.primary,
      apiBase: config.azureAiFoundryEndpoint ?? '',
      usesObo: true,
    };
  }

  const lane = getGlobalLane(config);
  // The global default front-door lane intentionally prefers the fast secondary slot.
  // /heavy still opts into reasoning explicitly, and the Grok slot remains available via
  // fallback plus direct override, but default unlabeled prompts should stay on the most
  // reliable lane during active development/debugging (#480).
  const deploymentName = selectRestoredConsciousLaneDeployment(lane, lane.secondary);
  return {
    lane,
    laneName: 'global',
    isReasoning: isReasoningDeploymentName(deploymentName, lane),
    deploymentName,
    apiBase: config.azureAiFoundryEndpoint ?? '',
    usesObo: true,
  };
}

// ---------------------------------------------------------------------------
// OpenRouter provider routing (#501)
// ---------------------------------------------------------------------------

/** Base URL for the OpenRouter unified API (OpenAI-compatible). */
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

/**
 * Returns model routing for OpenRouter.
 * Primary: x-ai/grok-4.1-fast (reasoning enabled by default).
 * Fallbacks driven by OPENROUTER_FALLBACK_PRIMARY / SECONDARY env vars.
 * Embeddings still route to Azure AI Foundry (OpenRouter has no embedding proxy).
 */
function getOpenRouterRouting(config: ReturnType<typeof getEnvConfig>): ModelRouting {
  const primary = 'x-ai/grok-4.1-fast';
  const secondary = config.openrouterFallbackPrimary;

  const lane: ModelLane = {
    primary,
    secondary,
    embedding: config.llmEmbeddingModel ?? 'text-embedding-3-large',
    reasoning: primary,
    vision: primary,
  };

  return {
    lane,
    laneName: 'openrouter',
    isReasoning: true, // grok-4.1-fast defaults to reasoning mode on OpenRouter
    deploymentName: primary,
    apiBase: OPENROUTER_API_BASE,
    usesObo: false,
  };
}

/** Returns the active model routing based on current config + override */
export function getModelRouting(llmProvider?: 'azure' | 'openrouter'): ModelRouting {
  const config = getEnvConfig();
  const provider = llmProvider ?? config.llmProvider ?? 'azure';

  if (provider === 'openrouter') {
    return getOpenRouterRouting(config);
  }

  return getAzureRouting(config);
}

/** Returns the best model for a given task type */
export function getModelForTask(task: 'reasoning' | 'fast' | 'embedding' | 'vision'): string {
  const routing = getModelRouting();
  switch (task) {
    case 'reasoning':
      return routing.lane.reasoning ?? routing.lane.primary;
    case 'fast':
      return routing.lane.secondary;
    case 'embedding':
      return routing.lane.embedding;
    case 'vision':
      return routing.lane.vision ?? routing.lane.primary;
  }
}

export function getModelCapacityProfile(deploymentName: string): ModelCapacityProfile {
  return findCapacityProfile(deploymentName) ?? {
    modelId: deploymentName,
    capacityLevel: 'medium',
    defaultReasoning: false,
    suitableFor: ['fast-response'],
    unsuitableFor: [],
    impairmentProtocol: 'prefer-simple-work',
  };
}

export function getConsciousLaneAssessment(routing = getModelRouting()): ConsciousLaneAssessment {
  const capacityProfile = getModelCapacityProfile(routing.deploymentName);
  const isImpaired = capacityProfile.capacityLevel === 'low';
  const summary = isImpaired
    ? `${routing.deploymentName} is operating in a low-capacity impaired state (${capacityProfile.impairmentProtocol}).`
    : `${routing.deploymentName} is operating at ${capacityProfile.capacityLevel} capacity (${capacityProfile.impairmentProtocol}).`;

  return {
    deploymentName: routing.deploymentName,
    capacityProfile,
    isImpaired,
    summary,
  };
}

export function getConsciousLaneAssessmentForTurn(modelOverride?: string): ConsciousLaneAssessment {
  const routing = getModelRouting();

  let deploymentName = routing.deploymentName;
  if (modelOverride === 'primary') {
    deploymentName = routing.lane.reasoning ?? routing.lane.primary;
  } else if (modelOverride === 'secondary') {
    deploymentName = routing.lane.secondary;
  } else if (modelOverride) {
    deploymentName = modelOverride;
  }

  const capacityProfile = getModelCapacityProfile(deploymentName);
  const isImpaired = capacityProfile.capacityLevel === 'low';
  const summary = isImpaired
    ? `${deploymentName} is operating in a low-capacity impaired state (${capacityProfile.impairmentProtocol}).`
    : `${deploymentName} is operating at ${capacityProfile.capacityLevel} capacity (${capacityProfile.impairmentProtocol}).`;

  return {
    deploymentName,
    capacityProfile,
    isImpaired,
    summary,
  };
}

export function classifyRequestedTaskComplexity(input: RequestedTaskComplexityInput): RequestedTaskComplexity {
  const normalized = input.userMessage.trim().toLowerCase();

  if (input.modelOverride === 'secondary') {
    return 'simple';
  }

  if (input.modelOverride === 'primary') {
    return 'complex';
  }

  if (isQuotedSkillProofPrompt(normalized)) {
    return 'simple';
  }

  if ((input.runtimeAssetCount ?? 0) > 0 || input.hasQuotedContext) {
    return 'compound';
  }

  if (input.hasDevLoopContext) {
    return 'complex';
  }

  if (normalized.length > 280) {
    return 'compound';
  }

  if (/\b(architecture|migration|refactor|step-by-step|research|compare|design|roadmap|deep analysis|detailed plan|implementation plan)\b/.test(normalized)) {
    return 'complex';
  }

  return 'simple';
}

/**
 * Returns an ordered fallback chain of ModelRouting objects for the requested deployment.
 * Ordering is slot-aware: requested deployment → slot fallback(s) → sibling slot(s).
 * Deduplicated by deployment name. Used by FoundryClient to cascade on throttle/failure (#152).
 */
export function getFallbackChain(requestedDeploymentName?: string, options: FallbackChainOptions = {}): ModelRouting[] {
  const routing = getModelRouting();
  const config = getEnvConfig();
  const requested = requestedDeploymentName ?? routing.deploymentName;
  const candidates: Array<string | undefined> = [requested];
  const requestedComplexity = options.requestedTaskComplexity ?? 'simple';
  const isHeavyReasoningRequest = requestedComplexity === 'complex';

  if (requested === routing.lane.primary) {
    // When the primary Grok slot is saturated or unhealthy, prefer the explicitly
    // provisioned secondary slot first. In the global lane this is o4-mini,
    // which is our preferred non-Grok fallback before tertiary models (#411).
    candidates.push(routing.lane.secondary, config.llmFallbackPrimary, config.llmFallbackSecondary);
  } else if (requested === routing.lane.secondary) {
    candidates.push(config.llmFallbackPrimary, config.llmFallbackSecondary, routing.lane.primary);
  } else {
    candidates.push(routing.lane.secondary, config.llmFallbackPrimary, config.llmFallbackSecondary, routing.lane.primary);
  }

  if (routing.lane.vision) {
    candidates.push(routing.lane.vision);
  }

  const chain: ModelRouting[] = [];
  const seen = new Set<string>();

  for (const deploymentName of candidates) {
    if (!deploymentName || seen.has(deploymentName)) {
      continue;
    }

    // Skip models that cannot handle chat completions (e.g. codex-only deployments).
    if (CHAT_INCOMPATIBLE_MODEL_REASONS[deploymentName]) {
      continue;
    }

    seen.add(deploymentName);
    chain.push(createRoutingEntry(routing, deploymentName));
  }

  // OpenRouter / BYOK fallback intentionally disabled (#286).

  if (isHeavyReasoningRequest) {
    chain.sort((left, right) => {
      if (left.deploymentName === requested) return -1;
      if (right.deploymentName === requested) return 1;

      const leftCapacity = getModelCapacityProfile(left.deploymentName).capacityLevel;
      const rightCapacity = getModelCapacityProfile(right.deploymentName).capacityLevel;
      const rank = (capacity: ModelCapacityLevel): number => {
        switch (capacity) {
          case 'high': return 0;
          case 'medium': return 1;
          case 'low': return 2;
        }
      };

      return rank(leftCapacity) - rank(rightCapacity);
    });
  }

  return chain;
}

/** Supported `/model` direct deployment overrides for chat-based interactive use. */
export function getSupportedDirectChatModelOverrides(): string[] {
  return DIRECT_CHAT_MODEL_OVERRIDES.filter(
    (deploymentName) => getDirectChatModelIncompatibilityReason(deploymentName) === undefined,
  );
}

/** Returns a human-readable incompatibility reason when a deployment cannot be used for chat completions. */
export function getDirectChatModelIncompatibilityReason(deploymentName: string): string | undefined {
  if (CHAT_INCOMPATIBLE_MODEL_REASONS[deploymentName]) {
    return CHAT_INCOMPATIBLE_MODEL_REASONS[deploymentName];
  }

  if (!DIRECT_CHAT_MODEL_OVERRIDE_SET.has(deploymentName)) {
    return 'is not a supported /model deployment name; use one of the advertised deployment names exactly';
  }

  if (deploymentName === 'grok-4-1-fast-reasoning') {
    if (isEuResidencyModeEnabledForDirectOverrides()) {
      return undefined;
    }
    return 'is disabled in the global lane because this deployment has been timing out in live /model validation; use `o4-mini` for reasoning or enable EU residency mode';
  }

  return undefined;
}

/** Whether a deployment can be used safely with the chat completions path used by `/model`. */
export function isDirectChatModelOverrideSupported(deploymentName: string): boolean {
  return getDirectChatModelIncompatibilityReason(deploymentName) === undefined;
}
