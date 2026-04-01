import { z } from 'zod';
import type { McpRegistryCandidate } from './mcpRegistryCatalog.js';

export const McpLifecycleStateSchema = z.enum([
  'discovered',
  'review-required',
  'blocked',
  'approved',
  'installed',
  'enabled',
]);
export type McpLifecycleState = z.infer<typeof McpLifecycleStateSchema>;

export const McpLifecycleTransitionSchema = z.object({
  state: McpLifecycleStateSchema,
  at: z.string().datetime(),
  reason: z.string().min(1),
});
export type McpLifecycleTransition = z.infer<typeof McpLifecycleTransitionSchema>;

export const McpActivationGateSchema = z.object({
  discoveredFrom: z.literal('official-mcp-registry-cache'),
  sourceStatus: z.enum(['active', 'deprecated', 'deleted']),
  moderationTrust: z.literal('minimal-external-moderation'),
  metadataQuality: z.enum(['sufficient', 'insufficient']),
  aiApprovalEligible: z.boolean(),
  blockedReasons: z.array(z.string().min(1)),
  reviewReasons: z.array(z.string().min(1)),
  installedSkillId: z.string().nullable(),
});
export type McpActivationGate = z.infer<typeof McpActivationGateSchema>;

export const McpLifecycleSnapshotSchema = z.object({
  currentState: McpLifecycleStateSchema,
  transitions: z.array(McpLifecycleTransitionSchema).min(1),
});
export type McpLifecycleSnapshot = z.infer<typeof McpLifecycleSnapshotSchema>;

export function draftSkillIdForCandidate(candidateName: string): string {
  return `mcp-${candidateName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)}`;
}

export function assessMcpCandidateForOnboarding(
  candidate: McpRegistryCandidate,
  options: {
    installedSkillId?: string | null;
  } = {},
): {
  currentState: 'discovered' | 'review-required' | 'blocked' | 'enabled';
  activationGate: McpActivationGate;
} {
  const blockedReasons: string[] = [];
  const reviewReasons: string[] = [];
  const installedSkillId = options.installedSkillId ?? null;
  const hasDraftableStdioPackage = candidate.packageSummaries.some(
    (pkg) => pkg.registryType === 'npm' && pkg.transportType === 'stdio' && pkg.identifier.trim().length > 0,
  );

  if (candidate.status === 'deleted') {
    blockedReasons.push('Registry marks this candidate as deleted; treat as quarantined and non-activatable.');
  }

  if (!hasDraftableStdioPackage) {
    blockedReasons.push('Candidate lacks a draftable npm/stdio package shape required by the current runtime activation path.');
  }

  if (candidate.status === 'deprecated') {
    reviewReasons.push('Registry marks this candidate as deprecated. Direct AI approval is disabled until an explicit override path exists.');
  }

  const activationGate: McpActivationGate = {
    discoveredFrom: 'official-mcp-registry-cache',
    sourceStatus: candidate.status,
    moderationTrust: 'minimal-external-moderation',
    metadataQuality: blockedReasons.length > 0 ? 'insufficient' : 'sufficient',
    aiApprovalEligible: blockedReasons.length === 0 && reviewReasons.length === 0,
    blockedReasons,
    reviewReasons,
    installedSkillId,
  };

  if (installedSkillId) {
    return { currentState: 'enabled', activationGate };
  }
  if (blockedReasons.length > 0) {
    return { currentState: 'blocked', activationGate };
  }
  if (reviewReasons.length > 0) {
    return { currentState: 'review-required', activationGate };
  }
  return { currentState: 'discovered', activationGate };
}

export function createLifecycleSnapshot(
  currentState: McpLifecycleState,
  transitions: McpLifecycleTransition[],
): McpLifecycleSnapshot {
  return McpLifecycleSnapshotSchema.parse({ currentState, transitions });
}
