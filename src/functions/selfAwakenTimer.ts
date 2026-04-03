import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import * as df from 'durable-functions';
import { getConversationReference, saveConversationReference } from '../bot/conversationStore.js';
import { getEnvConfig } from '../config/envConfig.js';
import {
  listDueChronoScheduledWakes,
  markChronoScheduledWakeDispatched,
  saveChronoInterruptionBreadcrumb,
} from '../orchestrator/chronoBackplane.js';
import { resolveActiveOverseerSummary } from '../orchestrator/activeOverseerInstance.js';
import { recordLimbicIngressDecision } from '../orchestrator/limbicIngressActivity.js';
import {
  MAX_INTERRUPTION_DEPTH,
  readMindSessionGuardState,
  signalMindSessionAcquire,
} from '../orchestrator/mindSessionGuard.js';
import type { NewMessageEvent } from '../orchestrator/overseer.js';
import { getActiveTurnCountForUser } from '../observability/orchestratorStageHealth.js';
import { trackEvent } from '../observability/telemetry.js';

function isStartConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('409') || message.includes('already exists') || message.includes('conflict');
}

app.timer('selfAwakenTimer', {
  schedule: '0 * * * * *',
  extraInputs: [df.input.durableClient()],
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const client = df.getClient(context);
    const wakes = await listDueChronoScheduledWakes();
    if (wakes.length === 0) {
      return;
    }

    context.log(`[selfAwakenTimer] Found ${wakes.length} due wake(s)`);

    for (const wake of wakes) {
      const correlationId = `wake-${wake.id}`;
      try {
        const conversationReference = wake.conversationReferenceJson
          ? JSON.parse(wake.conversationReferenceJson)
          : await getConversationReference(wake.userId);

        if (!conversationReference) {
          context.warn(`[selfAwakenTimer] No conversation reference for wake ${wake.id}`);
          continue;
        }

        await saveConversationReference(wake.userId, conversationReference);

        const guardState = await readMindSessionGuardState(client, wake.userId);
        const activeSummary = await resolveActiveOverseerSummary(client, wake.userId);
        const activeTurnCount = await getActiveTurnCountForUser(wake.userId);
        const observedActiveInstanceId = activeSummary.latestInstanceId;
        const effectiveActiveInstanceId = observedActiveInstanceId ?? (activeTurnCount > 0 ? guardState?.activeInstanceId : undefined);
        const hasActiveGuard = activeTurnCount > 0 && effectiveActiveInstanceId !== undefined;
        const interruptionDepth = Math.max(
          guardState?.interruptionDepth ?? 0,
          Math.max(0, activeTurnCount - 1),
        );

        const ingressDecision = recordLimbicIngressDecision({
          source: 'self-awaken',
          userId: wake.userId,
          correlationId,
          compatibilityMode: getEnvConfig().livingMindCompatibilityMode,
          hasActiveSession: hasActiveGuard,
          interruptionDepth,
          interruptionDepthCap: MAX_INTERRUPTION_DEPTH,
        });

        if (hasActiveGuard && effectiveActiveInstanceId) {
          await saveChronoInterruptionBreadcrumb({
            userId: wake.userId,
            interruptedInstanceId: effectiveActiveInstanceId,
            interruptedCorrelationId: guardState?.activeCorrelationId,
            interruptedSource: guardState?.activeSource,
            interruptedByCorrelationId: correlationId,
            interruptedByMessage: wake.wakeMessage,
          });

          trackEvent({
            name: 'PolicyOverrideApplied',
            correlationId,
            userId: wake.userId,
            properties: {
              authority: 'mind-session-guard-compatibility-mode',
              source: 'self-awaken',
              activeInstanceId: effectiveActiveInstanceId,
              interruptionDepth,
            },
          });
        }

        const instanceId = `overseer-${wake.userId}-wake-${wake.id.split(':').at(-1) ?? crypto.randomUUID().slice(0, 8)}`;
        const event: NewMessageEvent = {
          userMessage: wake.wakeMessage,
          conversationReference,
          userId: wake.userId,
          userAlias: wake.userId.slice(0, 4),
          correlationId,
        };

        try {
          await client.startNew('overseer', { instanceId, input: event });
        } catch (error) {
          if (!isStartConflict(error)) {
            throw error;
          }
        }

        await signalMindSessionAcquire(client, wake.userId, {
          instanceId,
          correlationId,
          source: 'self-awaken',
        });

        await markChronoScheduledWakeDispatched(wake.id, wake.userId, correlationId);

        trackEvent({
          name: 'ChronoScheduledWakeTriggered',
          correlationId,
          userId: wake.userId,
          properties: {
            wakeId: wake.id,
            wakeAt: wake.wakeAt,
            decision: ingressDecision.decision,
            instanceId,
          },
        });
      } catch (error) {
        context.error(
          `[selfAwakenTimer] Failed wake ${wake.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  },
});