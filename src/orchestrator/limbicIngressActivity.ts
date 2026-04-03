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
  'start',
  'compat-start',
  'queue',
  'self-awaken',
]);

export const LimbicIngressInputSchema = z.object({
  source: LimbicIngressSourceSchema,
  userId: z.string().min(1),
  correlationId: z.string().min(1),
  compatibilityMode: z.boolean().default(true),
  hasActiveSession: z.boolean().default(false),
  interruptionDepth: z.number().int().nonnegative().default(0),
  interruptionDepthCap: z.number().int().positive().default(MAX_INTERRUPTION_DEPTH),
});

export const LimbicIngressDecisionSchema = z.object({
  decision: LimbicIngressDecisionNameSchema,
  reason: z.string().min(1),
});

export type LimbicIngressInput = z.infer<typeof LimbicIngressInputSchema>;
export type LimbicIngressDecision = z.infer<typeof LimbicIngressDecisionSchema>;

export function evaluateLimbicIngress(rawInput: LimbicIngressInput): LimbicIngressDecision {
  const input = LimbicIngressInputSchema.parse(rawInput);

  if (input.source === 'self-awaken') {
    return LimbicIngressDecisionSchema.parse({
      decision: 'self-awaken',
      reason: 'Self-scheduled wake events retain highest internal priority.',
    });
  }

  if (input.hasActiveSession && input.interruptionDepth >= input.interruptionDepthCap) {
    return LimbicIngressDecisionSchema.parse({
      decision: 'queue',
      reason: `Interruption depth cap (${input.interruptionDepthCap}) reached; queue the next same-identity turn instead of spawning another overlap.`,
    });
  }

  if (input.hasActiveSession) {
    return LimbicIngressDecisionSchema.parse({
      decision: 'queue',
      reason: 'Single-session enforcement is active: queue this same-identity overlap until the in-flight turn finishes.',
    });
  }

  if (input.compatibilityMode) {
    return LimbicIngressDecisionSchema.parse({
      decision: 'compat-start',
      reason: 'Compatibility mode preserves one-shot overseer startup while Limbic enforcement is incomplete.',
    });
  }

  return LimbicIngressDecisionSchema.parse({
    decision: 'start',
    reason: 'No active session detected and compatibility mode is disabled.',
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
      interruptionDepth: input.interruptionDepth,
      interruptionDepthCap: input.interruptionDepthCap,
    },
  });

  if (decision.decision === 'compat-start') {
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

  return decision;
}

df.app.activity('limbicIngressActivity', {
  handler: async (rawInput: unknown): Promise<LimbicIngressDecision> => {
    return recordLimbicIngressDecision(LimbicIngressInputSchema.parse(rawInput));
  },
});