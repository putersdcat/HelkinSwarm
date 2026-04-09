// Safety configuration — read from environment, validated with Zod.
// Spec ref: 04-Safety-Architecture.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import { z } from 'zod';

export const SafetyModeSchema = z.enum(['read-only', 'confirmation-gated', 'full-destructive']);
export type SafetyMode = z.infer<typeof SafetyModeSchema>;

export const SafetyConfigSchema = z.object({
  /** Safety mode set at deployment time via Bicep — cannot be changed at runtime */
  safetyMode: SafetyModeSchema.default('confirmation-gated'),
  /** Whether EU DataZoneStandard residency is enabled */
  euResidencyMode: z.boolean().default(false),
  /** Azure Content Safety endpoint (Prompt Shields) */
  contentSafetyEndpoint: z.string().url().optional(),
  /** Azure Content Safety key (from Key Vault via Managed Identity) */
  contentSafetyKey: z.string().optional(),
  /** Spot-check sample size when result count > 10 */
  spotCheckSampleSize: z.number().int().min(1).default(5),
  /** Spot-check threshold — verify ALL results when count <= this */
  spotCheckVerifyAllThreshold: z.number().int().min(1).default(10),
  /** Human confirmation timeout in seconds */
  confirmationTimeoutSeconds: z.number().int().positive().default(300),
  /** Whether the DevLoop bidirectional channel is enabled */
  devLoopEnabled: z.boolean().default(false),
});

export type SafetyConfig = z.infer<typeof SafetyConfigSchema>;

// ---------------------------------------------------------------------------
// Environment binding
// ---------------------------------------------------------------------------

function fromEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function fromEnvOptionalString(key: string): string | undefined {
  const value = process.env[key];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function fromEnvBool(key: string, fallback: boolean): boolean {
  const val = process.env[key]?.toLowerCase();
  if (val === 'true') return true;
  if (val === 'false') return false;
  return fallback;
}

function fromEnvInt(key: string, fallback: number): number {
  const val = parseInt(process.env[key] ?? '', 10);
  return isNaN(val) ? fallback : val;
}

export const safetyConfig: SafetyConfig = SafetyConfigSchema.parse({
  safetyMode: fromEnv('SAFETY_MODE', 'confirmation-gated'),
  euResidencyMode: fromEnvBool('EU_RESIDENCY_MODE', false),
  contentSafetyEndpoint: fromEnvOptionalString('AZURE_CONTENT_SAFETY_ENDPOINT'),
  contentSafetyKey: fromEnvOptionalString('AZURE_CONTENT_SAFETY_KEY'),
  spotCheckSampleSize: fromEnvInt('SPOT_CHECK_SAMPLE_SIZE', 5),
  spotCheckVerifyAllThreshold: fromEnvInt('SPOT_CHECK_VERIFY_ALL_THRESHOLD', 10),
  confirmationTimeoutSeconds: fromEnvInt('CONFIRMATION_TIMEOUT_SECONDS', 300),
  devLoopEnabled: fromEnvBool('DEVLOOP_ENABLED', false),
});

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export function isReadOnly(): boolean {
  return safetyConfig.safetyMode === 'read-only';
}

export function isConfirmationGated(): boolean {
  return safetyConfig.safetyMode === 'confirmation-gated';
}

export function isFullDestructive(): boolean {
  return safetyConfig.safetyMode === 'full-destructive';
}

export function isEuResidencyMode(): boolean {
  return safetyConfig.euResidencyMode;
}
