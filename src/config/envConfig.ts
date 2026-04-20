// Environment configuration — centralized, Zod-validated, singleton.
// All environment variables are validated here at startup.
// Spec ref: 03-Tech-Stack-Infrastructure.md, 11-Authentication-Identity.md

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const EnvConfigSchema = z.object({
  // Bot Framework
  microsoftAppId: z.string().min(1, 'MicrosoftAppId / MICROSOFT_APP_ID is required'),
  microsoftAppTenantId: z.string().min(1, 'MicrosoftAppTenantId / MICROSOFT_APP_TENANT_ID is required'),
  microsoftAppType: z.string().default('UserAssignedMsi'),

  // Managed Identity
  azureClientId: z.string().optional(),

  // LLM / AI Foundry
  azureAiFoundryEndpoint: z.string().url('AZURE_AI_FOUNDRY_ENDPOINT must be a valid URL').optional(),
  llmPrimaryModel: z.string().default('grok-4-1-fast-non-reasoning'),
  llmSecondaryModel: z.string().default('o4-mini'),
  llmFallbackPrimary: z.string().default('DeepSeek-V3.2'),
  llmFallbackSecondary: z.string().default('FW-Kimi-K2.5'),
  llmVisionModel: z.string().default('o4-mini'),
  llmEmbeddingModel: z.string().default('text-embedding-3-large'),

  // Cosmos DB
  cosmosEndpoint: z.string().optional(),
  cosmosDatabase: z.string().default('helkinswarm'),

  // Content Safety
  azureContentSafetyEndpoint: z.string().optional(),

  // Safety & Residency
  safetyMode: z.enum(['read-only', 'confirmation-gated', 'full-destructive']).default('confirmation-gated'),
  euResidencyMode: z.boolean().default(false),

  // Feature Flags
  skillforgeEnabled: z.boolean().default(false),
  devLoopEnabled: z.boolean().default(false),
  livingMindCompatibilityMode: z.boolean().default(false),

  // Turn-by-turn debug telemetry (spec: 0n-Turn-by-Turn-Debug-Telemetry.md)
  devTelemetryMode: z.enum(['off', 'minimal', 'standard', 'verbose']).default('verbose'),

  // Dirty dev / observability-off mode (#382)
  dirtyDevMode: z.boolean().default(false),

  // Bot OAuth (#31)
  botOAuthConnectionName: z.string().default('GraphOAuth'),

  // Delegated Auth — Entra app for user-delegated Graph access (OBO + OAuth card)
  entraDelegatedAuthClientId: z.string().optional(),
  entraOboClientSecret: z.string().optional(),

  // Owner
  ownerUserId: z.string().optional(),

  // OpenRouter / BYOK config (#501)
  llmProvider: z.enum(['azure', 'openrouter']).default('azure'),
  openrouterApiKey: z.string().optional(),
  openrouterFallbackPrimary: z.string().default('minimax/minimax-m2.7'),
  openrouterFallbackSecondary: z.string().default('minimax/minimax-m2.7'),
  // OpenRouter attribution headers — per https://openrouter.ai/docs/quickstart (#677)
  openrouterReferer: z.string().default('https://github.com/putersdcat/HelkinSwarm'),
  openrouterTitle: z.string().default('HelkinSwarm'),
  // Max concurrent in-flight OpenRouter requests per process (#677, #690, #693).
  // Temporary dev-phase headroom is set to 10 so overlapping swarm sessions,
  // decomposer calls, leader synthesis, and ad-hoc debug traffic can coexist
  // while the session lifecycle / orphan reconciliation hardening continues.
  // This is intentionally higher than the old default 3 (too low for a
  // 4-member Grok swarm) and the previous bump to 8 (insufficient headroom
  // when sessions overlap due to dedup-window / pending-intent replay).
  openrouterMaxConcurrency: z.coerce.number().int().positive().default(10),

  // Web search (Brave Search API) — key from Key Vault (#190)
  braveSearchApiKey: z.string().optional(),

  // Azure context — subscription + RG for helkin_get_costs (#232)
  azureSubscriptionId: z.string().optional(),
  azureResourceGroup: z.string().optional(),

  // Local dev overrides (never set in production)
  azureFoundryOboToken: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvConfigSchema>;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function loadFromEnv(): EnvConfig {
  const raw = {
    microsoftAppId: process.env['MicrosoftAppId'] ?? process.env['MICROSOFT_APP_ID'] ?? '',
    microsoftAppTenantId: process.env['MicrosoftAppTenantId'] ?? process.env['MICROSOFT_APP_TENANT_ID'] ?? '',
    microsoftAppType: process.env['MICROSOFT_APP_TYPE'] ?? 'UserAssignedMsi',
    azureClientId: process.env['AZURE_CLIENT_ID'] || undefined,
    azureAiFoundryEndpoint: process.env['AZURE_AI_FOUNDRY_ENDPOINT'] || undefined,
    llmPrimaryModel: process.env['LLM_PRIMARY_MODEL'] || undefined,
    llmSecondaryModel: process.env['LLM_SECONDARY_MODEL'] || undefined,
    llmFallbackPrimary: process.env['LLM_FALLBACK_PRIMARY'] || undefined,
    llmFallbackSecondary: process.env['LLM_FALLBACK_SECONDARY'] || undefined,
    llmVisionModel: process.env['LLM_VISION_MODEL'] || undefined,
    llmEmbeddingModel: process.env['LLM_EMBEDDING_MODEL'] || undefined,
    cosmosEndpoint: process.env['COSMOS_ENDPOINT'] || undefined,
    cosmosDatabase: process.env['COSMOS_DATABASE'] || undefined,
    azureContentSafetyEndpoint: process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] || undefined,
    safetyMode: process.env['SAFETY_MODE'] || undefined,
    euResidencyMode: process.env['EU_RESIDENCY_MODE']?.toLowerCase() === 'true',
    skillforgeEnabled: process.env['SKILLFORGE_ENABLED']?.toLowerCase() === 'true',
    devLoopEnabled: process.env['DEVLOOP_ENABLED']?.toLowerCase() === 'true',
    livingMindCompatibilityMode: process.env['LIVING_MIND_COMPAT_MODE'] === undefined
      ? undefined
      : process.env['LIVING_MIND_COMPAT_MODE']?.toLowerCase() === 'true',
    devTelemetryMode: process.env['DEV_TELEMETRY_MODE'] || undefined,
    dirtyDevMode: process.env['DIRTY_DEV_MODE']?.toLowerCase() === 'true',
    botOAuthConnectionName: process.env['BOT_OAUTH_CONNECTION_NAME'] || undefined,
    entraDelegatedAuthClientId: process.env['ENTRA_DELEGATED_AUTH_CLIENT_ID'] || undefined,
    entraOboClientSecret: process.env['ENTRA_OBO_CLIENT_SECRET'] || undefined,
    ownerUserId: process.env['OWNER_USER_ID'] || undefined,
    llmProvider: process.env['LLM_PROVIDER'] || undefined,
    openrouterApiKey: process.env['OPENROUTER_API_KEY'] || undefined,
    openrouterFallbackPrimary: process.env['OPENROUTER_FALLBACK_PRIMARY'] || undefined,
    openrouterFallbackSecondary: process.env['OPENROUTER_FALLBACK_SECONDARY'] || undefined,
    openrouterReferer: process.env['OPENROUTER_REFERER'] || undefined,
    openrouterTitle: process.env['OPENROUTER_TITLE'] || undefined,
    openrouterMaxConcurrency: process.env['OPENROUTER_MAX_CONCURRENCY'] || undefined,
    braveSearchApiKey: process.env['BRAVE_SEARCH_API_KEY'] || undefined,
    azureSubscriptionId: process.env['AZURE_SUBSCRIPTION_ID'] || undefined,
    azureResourceGroup: process.env['AZURE_RESOURCE_GROUP'] || undefined,
    azureFoundryOboToken: process.env['AZURE_FOUNDRY_OBO_TOKEN'] || undefined,
  };

  return EnvConfigSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _config: EnvConfig | undefined;

export function getEnvConfig(): EnvConfig {
  if (!_config) {
    _config = loadFromEnv();
  }
  return _config;
}

/**
 * Validate environment configuration eagerly (call at startup).
 * Throws ZodError with clear messages if required vars are missing.
 */
export function validateEnvConfig(): EnvConfig {
  return getEnvConfig();
}
