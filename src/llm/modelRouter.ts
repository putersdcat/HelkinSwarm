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
}

const GLOBAL_LANE: ModelLane = {
  primary: 'grok-4-1-fast-reasoning',
  secondary: 'grok-4-1-fast-non-reasoning',
  embedding: 'text-embedding-3-large',
  reasoning: 'grok-4-1-fast-reasoning',
};

const EU_LANE: ModelLane = {
  // DataZoneStandard deployments only — data stays within EU boundary.
  // Grok models are already DataZoneStandard in Bicep.
  primary: 'grok-4-1-fast-reasoning',
  secondary: 'grok-4-1-fast-non-reasoning',
  embedding: 'text-embedding-3-large', // GlobalStandard — no DZ embedding exists yet
  reasoning: 'grok-4-1-fast-reasoning',
};

const BYOK_LANE: ModelLane = {
  primary: 'gpt-4o',
  secondary: 'gpt-4o-mini',
  embedding: 'text-embedding-3-large',
  reasoning: undefined,
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface ModelRouting {
  /** The resolved model lane */
  lane: ModelLane;
  /** Which lane we are using (for telemetry) */
  laneName: 'global' | 'eu' | 'byok';
  /** Whether this is a reasoning model */
  isReasoning: boolean;
  /** Deployment name in Azure AI Foundry */
  deploymentName: string;
  /** API base URL */
  apiBase: string;
  /** Whether OBO token flow is required */
  usesObo: boolean;
}

/** Returns the active model routing based on current config + override */
export function getModelRouting(llmProvider?: 'azure' | 'openrouter'): ModelRouting {
  const config = getEnvConfig();
  const provider = llmProvider ?? 'azure';

  if (provider === 'openrouter') {
    // BYOK / OpenRouter path — global models via OpenRouter
    return {
      lane: BYOK_LANE,
      laneName: 'byok',
      isReasoning: false,
      deploymentName: BYOK_LANE.primary,
      apiBase: 'https://openrouter.ai/api/v1',
      usesObo: false,
    };
  }

  // EU DataZoneStandard lane — restricts to DZ-only deployments
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

  // Azure AI Foundry global frontier (default — Unchained)
  return {
    lane: GLOBAL_LANE,
    laneName: 'global',
    isReasoning: true,
    deploymentName: config.llmPrimaryModel,
    apiBase: config.azureAiFoundryEndpoint ?? '',
    usesObo: true,
  };
}

/** Returns the best model for a given task type */
export function getModelForTask(task: 'reasoning' | 'fast' | 'embedding'): string {
  const routing = getModelRouting();
  switch (task) {
    case 'reasoning':
      return routing.lane.reasoning ?? routing.lane.primary;
    case 'fast':
      return routing.lane.secondary;
    case 'embedding':
      return routing.lane.embedding;
  }
}
