import * as df from 'durable-functions';
import { z } from 'zod';
import { trackEvent } from '../observability/telemetry.js';

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

  if (input.compatibilityMode) {
    return LimbicIngressDecisionSchema.parse({
      decision: 'compat-start',
      reason: 'Compatibility mode preserves one-shot overseer startup while Limbic enforcement is incomplete.',
    });
  }

  if (input.hasActiveSession) {
    return LimbicIngressDecisionSchema.parse({
      decision: 'queue',
      reason: 'An active session already exists; future enforcement should queue or steer instead of spawning parallel work.',
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