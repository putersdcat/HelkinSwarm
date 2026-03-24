// Capability manifest Zod schema — validates skills/*/manifest.json at load time.
// Spec ref: 05-Capabilities-Framework.md, skills-system-enhancement-2026-03-24v2.md §3
// Issue: #52, #196

import { z } from 'zod';

export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const DataSensitivity = z.enum(['non-pii', 'pii', 'mixed']);
export type DataSensitivity = z.infer<typeof DataSensitivity>;

export const AllowedModelLane = z.enum(['any', 'global', 'eu-only']);
export type AllowedModelLane = z.infer<typeof AllowedModelLane>;

export const DeploymentScenario = z.enum(['personal-user-centric', 'enterprise-commercial']);
export type DeploymentScenario = z.infer<typeof DeploymentScenario>;

export const OnboardingMethod = z.enum(['automatic-agentic', 'post-install-link', 'both']);
export type OnboardingMethod = z.infer<typeof OnboardingMethod>;

export const LifecycleRules = z.enum(['keep-credentials', 'close-external-account', 'ask-user']);
export type LifecycleRules = z.infer<typeof LifecycleRules>;

export const ExternalAutomationCapability = z.object({
  type: z.string(),
  action: z.string(),
});

export const MaintenanceTask = z.object({
  name: z.string().min(1),
  type: z.enum(['scheduled', 'event-driven']),
  schedule: z.string().optional(),
  description: z.string().min(1),
});

export const SoftOnboarding = z.object({
  preferredAddress: z.string().optional(),
  responseStyle: z.enum(['concise', 'long']).optional(),
}).passthrough();

export const ToolManifestEntry = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Tool names must be snake_case'),
  description: z.string().min(1),
  risk: RiskLevel,
  dataSensitivity: DataSensitivity,
  allowedModelLane: AllowedModelLane.default('any'),
  requiresConfirmation: z.boolean().default(false),
  requiresExecutor: z.boolean().default(false),
  /** Route through isolated sub-agent LLM session (#47) */
  requiresSubAgent: z.boolean().default(false),
  externalAutomationCapabilities: z.array(ExternalAutomationCapability).default([]),
  longTermMemorySchema: z.array(z.string()).default([]),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});

export type ToolManifestEntry = z.infer<typeof ToolManifestEntry>;

export const LinkConfigSchema = z.object({
  connectionName: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
});

export type LinkConfig = z.infer<typeof LinkConfigSchema>;

export const CapabilityManifestSchema = z.object({
  domain: z.string().min(1),
  version: z.string().min(1),
  tools: z.array(ToolManifestEntry).min(1),
  linkConfig: LinkConfigSchema.optional(),
  // v2 fields (#196) — spec ref: skills-system-enhancement-2026-03-24v2.md §3
  shortName: z.string().min(1),
  displayName: z.string().min(1),
  shortDescription: z.string().min(1),
  iconUrl: z.string().url(),
  deploymentScenario: DeploymentScenario,
  onboardingMethod: OnboardingMethod,
  lifecycleRules: LifecycleRules,
  dependencies: z.array(z.string()).optional(),
  requiredPermissions: z.array(z.string()).optional(),
  externalAccountsNeeded: z.array(z.string()).optional(),
  softOnboarding: SoftOnboarding.optional(),
  maintenanceTasks: z.array(MaintenanceTask).optional(),
});

export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
