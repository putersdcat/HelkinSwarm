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
  llmPrimaryModel: z.string().default('grok-4-1-fast-reasoning'),
  llmSecondaryModel: z.string().default('grok-4-1-fast-non-reasoning'),
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

  // Bot OAuth (#31)
  botOAuthConnectionName: z.string().default('GraphOAuth'),

  // Owner
  ownerUserId: z.string().optional(),

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
    llmEmbeddingModel: process.env['LLM_EMBEDDING_MODEL'] || undefined,
    cosmosEndpoint: process.env['COSMOS_ENDPOINT'] || undefined,
    cosmosDatabase: process.env['COSMOS_DATABASE'] || undefined,
    azureContentSafetyEndpoint: process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] || undefined,
    safetyMode: process.env['SAFETY_MODE'] || undefined,
    euResidencyMode: process.env['EU_RESIDENCY_MODE']?.toLowerCase() === 'true',
    skillforgeEnabled: process.env['SKILLFORGE_ENABLED']?.toLowerCase() === 'true',
    devLoopEnabled: process.env['DEVLOOP_ENABLED']?.toLowerCase() === 'true',
    botOAuthConnectionName: process.env['BOT_OAUTH_CONNECTION_NAME'] || undefined,
    ownerUserId: process.env['OWNER_USER_ID'] || undefined,
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
