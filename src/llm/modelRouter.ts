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

const GLOBAL_LANE: ModelLane = {
  primary: 'grok-4-1-fast-non-reasoning',
  secondary: 'grok-4-1-fast-non-reasoning',
  embedding: 'text-embedding-3-large',
  // grok-4-1-fast-reasoning consistently times out (>55s); tracked in #128
  reasoning: 'o4-mini',
  vision: 'gpt-5.4-mini', // vision-capable fallback
};

const EU_LANE: ModelLane = {
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

function getAzureRouting(config: ReturnType<typeof getEnvConfig>): ModelRouting {
  if (config.euResidencyMode) {
    return {
      lane: EU_LANE,
      laneName: 'eu',
      isReasoning: true,
      deploymentName: EU_LANE.primary,
      apiBase: config.azureAiFoundryEndpoint ?? '',
      usesObo: true,
    };
  }

  const deploymentName = config.llmPrimaryModel;
  return {
    lane: GLOBAL_LANE,
    laneName: 'global',
    isReasoning: deploymentName === GLOBAL_LANE.reasoning || deploymentName.includes('reasoning'),
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
 * Returns an ordered fallback chain of ModelRouting objects: primary → secondary
 * → BYOK (if configured). Deduplicated by deployment name.
 * Used by FoundryClient to cascade through models on throttle/failure (#152).
 */
export function getFallbackChain(): ModelRouting[] {
  const primary = getModelRouting();
  const chain: ModelRouting[] = [primary];
  const seen = new Set<string>([primary.deploymentName]);

  // Secondary model in the same lane
  const secondaryName = primary.lane.secondary;
  if (secondaryName && !seen.has(secondaryName)) {
    seen.add(secondaryName);
    chain.push({
      ...primary,
      deploymentName: secondaryName,
      isReasoning: false,
    });
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
