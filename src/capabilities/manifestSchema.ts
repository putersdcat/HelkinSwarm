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

/** Privilege class for scoped token minting decisions (#316) */
export const PrivilegeClass = z.enum(['read-only', 'read-write', 'create', 'delete']);
export type PrivilegeClass = z.infer<typeof PrivilegeClass>;

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
export type MaintenanceTask = z.infer<typeof MaintenanceTask>;

export const ModelAffinity = z.object({
  discovery: z.enum(['fast', 'reasoning', 'primary']).optional(),
  execution: z.enum(['fast', 'reasoning', 'primary']).optional(),
  synthesis: z.enum(['fast', 'reasoning', 'primary']).optional(),
}).strict();
export type ModelAffinity = z.infer<typeof ModelAffinity>;

export const SoftOnboarding = z.object({
  preferredAddress: z.string().optional(),
  responseStyle: z.enum(['concise', 'long']).optional(),
}).passthrough();

export const CapabilityGroup = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/, 'Capability group ids must be lowercase kebab/snake style'),
  displayName: z.string().min(1),
  shortDescription: z.string().min(1),
  discoveryHints: z.array(z.string().min(1)).default([]),
  useWhen: z.array(z.string().min(1)).default([]),
  upstreamNamespace: z.string().min(1).optional(),
  upstreamToolSelectors: z.array(z.string().min(1)).default([]),
});
export type CapabilityGroup = z.infer<typeof CapabilityGroup>;

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
  /** Privilege class for scoped token minting scope decisions (#316) */
  privilegeClass: PrivilegeClass.default('read-only'),
  externalAutomationCapabilities: z.array(ExternalAutomationCapability).default([]),
  longTermMemorySchema: z.array(z.string()).default([]),
  aliases: z.array(z.string().min(1)).default([]),
  discoveryTerms: z.array(z.string().min(1)).default([]),
  useWhen: z.array(z.string().min(1)).default([]),
  avoidWhen: z.array(z.string().min(1)).default([]),
  typicalInputs: z.array(z.string().min(1)).default([]),
  returnsSummaryShape: z.string().min(1).optional(),
  capabilityGroup: z.string().min(1).optional(),
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
  capabilityGroups: z.array(CapabilityGroup).default([]),
  discoveryHints: z.array(z.string().min(1)).default([]),
  orchestratorUseCases: z.array(z.string().min(1)).default([]),
  modelAffinity: ModelAffinity.optional(),
  recommendedEntryTools: z.array(z.string().min(1)).default([]),
  softOnboarding: SoftOnboarding.optional(),
  maintenanceTasks: z.array(MaintenanceTask).optional(),
}).superRefine((manifest, ctx) => {
  const definedGroupIds = new Set((manifest.capabilityGroups ?? []).map((group) => group.id));

  for (const [index, tool] of manifest.tools.entries()) {
    if (tool.capabilityGroup && !definedGroupIds.has(tool.capabilityGroup)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Tool '${tool.name}' references unknown capabilityGroup '${tool.capabilityGroup}'.`,
        path: ['tools', index, 'capabilityGroup'],
      });
    }
  }
});

export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
