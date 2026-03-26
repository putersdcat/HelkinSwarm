// Model router — selects the best model based on EU residency toggle.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 0b-Model-Specific-Tool-Presentation.md

import { getEnvConfig } from '../config/envConfig.js';

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
  secondary: 'gpt-5.4-mini',
  embedding: 'text-embedding-3-large',
  // grok-4-1-fast-reasoning consistently times out (>55s); tracked in #128
  reasoning: 'o4-mini',
  vision: 'gpt-5.4-mini', // vision-capable fallback
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
  laneName: 'global' | 'eu';
  /** Whether this is a reasoning model */
  isReasoning: boolean;
  /** Deployment name in Azure AI Foundry */
  deploymentName: string;
  /** API base URL */
  apiBase: string;
  /** Whether OBO token flow is required */
  usesObo: boolean;
}

const DIRECT_CHAT_MODEL_OVERRIDES = [
  'grok-4-1-fast-non-reasoning',
  'grok-4-1-fast-reasoning',
  'gpt-5.4-mini',
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
  return deploymentName === lane.reasoning || deploymentName.includes('reasoning') || deploymentName.startsWith('o');
}

function createRoutingEntry(base: ModelRouting, deploymentName: string): ModelRouting {
  return {
    ...base,
    deploymentName,
    isReasoning: isReasoningDeploymentName(deploymentName, base.lane),
  };
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
  const deploymentName = lane.primary;
  return {
    lane,
    laneName: 'global',
    isReasoning: isReasoningDeploymentName(deploymentName, lane),
    deploymentName,
    apiBase: config.azureAiFoundryEndpoint ?? '',
    usesObo: true,
  };
}

/** Returns the active model routing based on current config + override */
export function getModelRouting(llmProvider?: 'azure' | 'openrouter'): ModelRouting {
  const config = getEnvConfig();
  const provider = llmProvider ?? config.llmProvider ?? 'azure';

  if (provider === 'openrouter') {
    // OpenRouter / BYOK is intentionally disabled for now (#286).
    // Callers still flow through the supported Azure routing path.
    return getAzureRouting(config);
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

/**
 * Returns an ordered fallback chain of ModelRouting objects for the requested deployment.
 * Ordering is slot-aware: requested deployment → slot fallback(s) → sibling slot(s).
 * Deduplicated by deployment name. Used by FoundryClient to cascade on throttle/failure (#152).
 */
export function getFallbackChain(requestedDeploymentName?: string): ModelRouting[] {
  const routing = getModelRouting();
  const config = getEnvConfig();
  const requested = requestedDeploymentName ?? routing.deploymentName;
  const candidates: Array<string | undefined> = [requested];

  if (requested === routing.lane.primary) {
    candidates.push(config.llmFallbackPrimary, routing.lane.secondary, config.llmFallbackSecondary);
  } else if (requested === routing.lane.secondary) {
    candidates.push(config.llmFallbackSecondary, config.llmFallbackPrimary, routing.lane.primary);
  } else {
    candidates.push(config.llmFallbackPrimary, routing.lane.secondary, routing.lane.primary, config.llmFallbackSecondary);
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
