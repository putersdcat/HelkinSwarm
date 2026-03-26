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
  llmSecondaryModel: z.string().default('gpt-5.4-mini'),
  llmFallbackPrimary: z.string().default('DeepSeek-V3.2'),
  llmFallbackSecondary: z.string().default('FW-Kimi-K2.5'),
  llmVisionModel: z.string().default('gpt-5.4-mini'),
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

  // Turn-by-turn debug telemetry (spec: 0n-Turn-by-Turn-Debug-Telemetry.md)
  devTelemetryMode: z.enum(['off', 'minimal', 'standard', 'verbose']).default('off'),

  // Bot OAuth (#31)
  botOAuthConnectionName: z.string().default('GraphOAuth'),

  // Delegated Auth — Entra app for user-delegated Graph access (OBO + OAuth card)
  entraDelegatedAuthClientId: z.string().optional(),
  entraOboClientSecret: z.string().optional(),

  // Owner
  ownerUserId: z.string().optional(),

  // OpenRouter / BYOK config (feature currently deferred; retained for future reactivation)
  llmProvider: z.enum(['azure', 'openrouter']).default('azure'),
  openrouterFallbackPrimary: z.string().default('moonshotai/kimi-k2.5'),
  openrouterFallbackSecondary: z.string().default('moonshotai/kimi-k2.5'),

  // Web search (Bing Web Search API v7) — key from Key Vault (#190)
  bingSearchApiKey: z.string().optional(),

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
    devTelemetryMode: process.env['DEV_TELEMETRY_MODE'] || undefined,
    botOAuthConnectionName: process.env['BOT_OAUTH_CONNECTION_NAME'] || undefined,
    entraDelegatedAuthClientId: process.env['ENTRA_DELEGATED_AUTH_CLIENT_ID'] || undefined,
    entraOboClientSecret: process.env['ENTRA_OBO_CLIENT_SECRET'] || undefined,
    ownerUserId: process.env['OWNER_USER_ID'] || undefined,
    llmProvider: process.env['LLM_PROVIDER'] || undefined,
    openrouterFallbackPrimary: process.env['OPENROUTER_FALLBACK_PRIMARY'] || undefined,
    openrouterFallbackSecondary: process.env['OPENROUTER_FALLBACK_SECONDARY'] || undefined,
    bingSearchApiKey: process.env['BING_SEARCH_API_KEY'] || undefined,
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
