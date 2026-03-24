// Capability manifest Zod schema — validates skills/*/manifest.json at load time.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #52

import { z } from 'zod';

export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const DataSensitivity = z.enum(['non-pii', 'pii', 'mixed']);
export type DataSensitivity = z.infer<typeof DataSensitivity>;

export const AllowedModelLane = z.enum(['any', 'global', 'eu-only']);
export type AllowedModelLane = z.infer<typeof AllowedModelLane>;

export const ExternalAutomationCapability = z.object({
  type: z.string(),
  action: z.string(),
});

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
});

export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
