import * as df from 'durable-functions';
import { z } from 'zod';
import { clearOrchestratorStage, recordOrchestratorStage } from '../observability/orchestratorStageHealth.js';
import { trackEvent } from '../observability/telemetry.js';

const IngressWindowStageInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('mark-active-processing'),
    correlationId: z.string().min(1),
    userId: z.string().min(1),
    instanceId: z.string().min(1),
  }),
  z.object({
    action: z.literal('open'),
    correlationId: z.string().min(1),
    userId: z.string().min(1),
    instanceId: z.string().min(1),
  }),
  z.object({
    action: z.literal('clear'),
    correlationId: z.string().min(1),
    userId: z.string().min(1),
  }),
  z.object({
    action: z.literal('drain'),
    correlationId: z.string().min(1),
    nextCorrelationId: z.string().min(1),
    userId: z.string().min(1),
    instanceId: z.string().min(1),
  }),
  z.object({
    action: z.literal('hook-drain'),
    correlationId: z.string().min(1),
    nextCorrelationId: z.string().min(1),
    userId: z.string().min(1),
    instanceId: z.string().min(1),
    hookId: z.string().min(1),
    hookType: z.string().min(1),
    triggerType: z.string().min(1).optional(),
  }),
]);

type IngressWindowStageInput = z.infer<typeof IngressWindowStageInputSchema>;
export type { IngressWindowStageInput };

export async function handleIngressWindowStage(rawInput: IngressWindowStageInput): Promise<void> {
  const input = IngressWindowStageInputSchema.parse(rawInput);

  if (input.action === 'mark-active-processing') {
    await recordOrchestratorStage(input.correlationId, 'active-processing', input.userId, Date.now(), input.instanceId);
    return;
  }

  if (input.action === 'open') {
    await recordOrchestratorStage(input.correlationId, 'awaiting-ingress', input.userId, Date.now(), input.instanceId);
    trackEvent({
      name: 'LivingSessionIngressWindowOpened',
      correlationId: input.correlationId,
      userId: input.userId,
      properties: {
        instanceId: input.instanceId,
      },
    });
    return;
  }

  if (input.action === 'clear') {
    await clearOrchestratorStage(input.correlationId, input.userId);
    return;
  }

  if (input.action === 'hook-drain') {
    await clearOrchestratorStage(input.correlationId, input.userId);
    trackEvent({
      name: 'LivingSessionHookDrained',
      correlationId: input.nextCorrelationId,
      userId: input.userId,
      properties: {
        instanceId: input.instanceId,
        previousCorrelationId: input.correlationId,
        hookId: input.hookId,
        hookType: input.hookType,
        triggerType: input.triggerType ?? 'unknown',
      },
    });
    return;
  }

  await clearOrchestratorStage(input.correlationId, input.userId);
  trackEvent({
    name: 'LivingSessionNewMessageDrained',
    correlationId: input.nextCorrelationId,
    userId: input.userId,
    properties: {
      instanceId: input.instanceId,
      previousCorrelationId: input.correlationId,
    },
  });
}

df.app.activity('ingressWindowStageActivity', {
  handler: async (rawInput: unknown): Promise<void> => {
    await handleIngressWindowStage(rawInput as IngressWindowStageInput);
  },
});