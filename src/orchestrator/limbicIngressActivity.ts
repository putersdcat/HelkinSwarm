import * as df from 'durable-functions';
import { z } from 'zod';
import { trackEvent } from '../observability/telemetry.js';
import { MAX_INTERRUPTION_DEPTH } from './mindSessionGuard.js';

export const LimbicIngressSourceSchema = z.enum([
  'teams-message',
  'pending-intent-replay',
  'hook-fired',
  'graph-notification',
  'devloop-relay',
  'self-awaken',
]);

export const LimbicIngressDecisionNameSchema = z.enum([
  'steer',
  'queue',
  'self-awaken',
  'defer',
]);

export const LimbicIngressTaskComplexitySchema = z.enum([
  'simple',
  'compound',
  'complex',
]);

export const LimbicIngressInputSchema = z.object({
  source: LimbicIngressSourceSchema,
  userId: z.string().min(1),
  correlationId: z.string().min(1),
  compatibilityMode: z.boolean().default(true),
  hasActiveSession: z.boolean().default(false),
  activeSessionRoutable: z.boolean().default(false),
  interruptionDepth: z.number().int().nonnegative().default(0),
  interruptionDepthCap: z.number().int().positive().default(MAX_INTERRUPTION_DEPTH),
  consciousModelImpaired: z.boolean().default(false),
  requestedTaskComplexity: LimbicIngressTaskComplexitySchema.default('simple'),
});

export const LimbicIngressDecisionSchema = z.object({
  decision: LimbicIngressDecisionNameSchema,
  reason: z.string().min(1),
});

export type LimbicIngressInput = z.input<typeof LimbicIngressInputSchema>;
export type LimbicIngressDecision = z.output<typeof LimbicIngressDecisionSchema>;

export function evaluateLimbicIngress(rawInput: LimbicIngressInput): LimbicIngressDecision {
  const input = LimbicIngressInputSchema.parse(rawInput);

  if (input.hasActiveSession && input.interruptionDepth >= input.interruptionDepthCap) {
    return LimbicIngressDecisionSchema.parse({
      decision: 'queue',
      reason: `Interruption depth cap (${input.interruptionDepthCap}) reached; queue the next same-identity turn instead of spawning another overlap.`,
    });
  }

  if (input.hasActiveSession && input.activeSessionRoutable) {
    return LimbicIngressDecisionSchema.parse({
      decision: 'steer',
      reason: 'A living same-identity session is already active and routable; redirect this work into the existing Conscious Thread instead of queueing or parallel-starting.',
    });
  }

  if (input.hasActiveSession) {
    return LimbicIngressDecisionSchema.parse({
      decision: 'queue',
      reason: 'Single-session enforcement is active, but no routable living session was found; queue this same-identity overlap until direct redirection is safe.',
    });
  }

  if (input.consciousModelImpaired && input.requestedTaskComplexity !== 'simple') {
    return LimbicIngressDecisionSchema.parse({
      decision: 'defer',
      reason: `Conscious lane is currently impaired; defer ${input.requestedTaskComplexity} work until a higher-capacity lane is restored.`,
    });
  }

  if (input.source === 'self-awaken') {
    return LimbicIngressDecisionSchema.parse({
      decision: 'self-awaken',
      reason: 'Self-scheduled wake events retain highest internal priority when the conscious lane is capable of handling them.',
    });
  }

  if (input.compatibilityMode) {
    return LimbicIngressDecisionSchema.parse({
      decision: 'steer',
      reason: 'Compatibility mode preserves one-shot overseer startup, but the ingress outcome is explicitly steer into the Conscious Thread.',
    });
  }

  return LimbicIngressDecisionSchema.parse({
    decision: 'steer',
    reason: 'No active session detected; steer this stimulus into the Conscious Thread.',
  });
}

export function recordLimbicIngressDecision(rawInput: LimbicIngressInput): LimbicIngressDecision {
  const input = LimbicIngressInputSchema.parse(rawInput);
  const decision = evaluateLimbicIngress(input);

  trackEvent({
    name: 'LimbicDecision',
    correlationId: input.correlationId,
    userId: input.userId,
    properties: {
      source: input.source,
      decision: decision.decision,
      reason: decision.reason,
      compatibilityMode: input.compatibilityMode,
      hasActiveSession: input.hasActiveSession,
      activeSessionRoutable: input.activeSessionRoutable,
      interruptionDepth: input.interruptionDepth,
      interruptionDepthCap: input.interruptionDepthCap,
    },
  });

  if (decision.decision === 'steer' && input.compatibilityMode && !input.hasActiveSession) {
    trackEvent({
      name: 'PolicyOverrideApplied',
      correlationId: input.correlationId,
      userId: input.userId,
      properties: {
        authority: 'living-mind-compatibility-mode',
        source: input.source,
        decision: decision.decision,
        interruptionDepth: input.interruptionDepth,
      },
    });
  }

  if (decision.decision === 'defer') {
    trackEvent({
      name: 'PolicyOverrideApplied',
      correlationId: input.correlationId,
      userId: input.userId,
      properties: {
        authority: 'living-mind-impairment-protocol',
        source: input.source,
        decision: decision.decision,
        requestedTaskComplexity: input.requestedTaskComplexity,
      },
    });
  }

  return decision;
}

df.app.activity('limbicIngressActivity', {
  handler: async (rawInput: unknown): Promise<LimbicIngressDecision> => {
    return recordLimbicIngressDecision(LimbicIngressInputSchema.parse(rawInput));
  },
});