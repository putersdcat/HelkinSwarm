// Pending intent replay helpers — shared by the replay timer and wake-up queue path.

import type { DurableClient } from 'durable-functions';
import type { ConversationReference } from 'botbuilder';
import { saveConversationReference } from '../bot/conversationStore.js';
import { getEnvConfig } from '../config/envConfig.js';
import type { DevLoopContext } from '../devloop/radioProtocol.js';
import { trackEvent } from '../observability/telemetry.js';
import {
  hasIdempotencyKey,
  markIntentFailed,
  markIntentProcessed,
  markIntentProcessing,
  markIntentReceived,
  type PendingIntent,
} from './pendingIntentStore.js';
import { saveChronoInterruptionBreadcrumb } from './chronoBackplane.js';
import { recordLimbicIngressDecision } from './limbicIngressActivity.js';
import {
  MAX_INTERRUPTION_DEPTH,
  readMindSessionGuardState,
  signalMindSessionAcquire,
} from './mindSessionGuard.js';
import type { NewMessageEvent } from './overseer.js';

export interface PendingIntentReplayDecision {
  replay: boolean;
  reason: string;
}

export interface PendingIntentReplayResult {
  outcome: 'replayed' | 'skipped' | 'deferred' | 'failed';
  reason: string;
  instanceId?: string;
}

export function shouldAutoReplay(intent: PendingIntent): PendingIntentReplayDecision {
  if (intent.riskLevel === 'high' || intent.riskLevel === 'critical') {
    return { replay: false, reason: 'High-risk intent requires live confirmation' };
  }
  if (intent.status === 'failed' && intent.failureReason) {
    return { replay: false, reason: `Previously failed: ${intent.failureReason}` };
  }
  return { replay: true, reason: 'Low-risk, eligible for auto-replay' };
}

export function getPendingIntentReplayInstanceId(intent: PendingIntent): string {
  return `pending-intent-${intent.id}`;
}

function isReplayConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('409') || message.includes('already exists') || message.includes('conflict');
}

export async function replayPendingIntent(
  client: DurableClient,
  intent: PendingIntent,
  source: string,
): Promise<PendingIntentReplayResult> {
  const alreadyDone = await hasIdempotencyKey(intent.idempotencyKey);
  if (alreadyDone) {
    return { outcome: 'skipped', reason: 'Idempotency key already processed' };
  }

  const decision = shouldAutoReplay(intent);
  if (!decision.replay) {
    return { outcome: 'skipped', reason: decision.reason };
  }

  const conversationReference = intent.conversationReferenceJson
    ? JSON.parse(intent.conversationReferenceJson) as ConversationReference
    : undefined;

  if (!conversationReference) {
    const reason = 'No conversation reference available';
    await markIntentFailed(intent.id, intent.userId, reason);
    return { outcome: 'failed', reason };
  }

  await markIntentProcessing(intent.id, intent.userId);

  try {
    let replayReason = decision.reason;

    await saveConversationReference(intent.userId, conversationReference);

    const devLoopContext = intent.devLoopContextJson
      ? JSON.parse(intent.devLoopContextJson) as DevLoopContext
      : undefined;

    const instanceId = getPendingIntentReplayInstanceId(intent);
    const event: NewMessageEvent = {
      userMessage: intent.messageText,
      conversationReference,
      userId: intent.userId,
      userAlias: 'recovered-intent',
      correlationId: intent.correlationId ?? intent.id,
      ...(intent.modelOverride ? { modelOverride: intent.modelOverride } : {}),
      ...(intent.imageUrls.length > 0 ? { imageUrls: intent.imageUrls } : {}),
      ...(intent.runtimeAssets.length > 0 ? { runtimeAssets: intent.runtimeAssets } : {}),
      ...(intent.attachmentNotices.length > 0 ? { attachmentNotices: intent.attachmentNotices } : {}),
      ...(devLoopContext ? { devLoopContext } : {}),
    };

    try {
      const guardState = await readMindSessionGuardState(client, intent.userId);
      const hasActiveGuard = guardState?.activeInstanceId !== undefined && guardState.activeInstanceId !== instanceId;
      const interruptionDepth = guardState?.interruptionDepth ?? 0;

      const ingressDecision = recordLimbicIngressDecision({
        source: 'pending-intent-replay',
        userId: intent.userId,
        correlationId: intent.correlationId ?? intent.id,
        compatibilityMode: getEnvConfig().livingMindCompatibilityMode,
        hasActiveSession: hasActiveGuard,
        interruptionDepth,
        interruptionDepthCap: MAX_INTERRUPTION_DEPTH,
      });
      replayReason = ingressDecision.reason;

      if (ingressDecision.decision === 'queue') {
        await markIntentReceived(intent.id, intent.userId, ingressDecision.reason);
        trackEvent({
          name: 'PendingIntentRecovered',
          correlationId: intent.correlationId ?? intent.id,
          userId: intent.userId,
          properties: {
            trackingId: intent.trackingId,
            action: 'deferred',
            reason: ingressDecision.reason,
            source,
          },
        });
        return { outcome: 'deferred', reason: ingressDecision.reason };
      }

      if (hasActiveGuard) {
        await saveChronoInterruptionBreadcrumb({
          userId: intent.userId,
          interruptedInstanceId: guardState.activeInstanceId ?? 'unknown',
          interruptedCorrelationId: guardState.activeCorrelationId,
          interruptedSource: guardState.activeSource,
          interruptedByCorrelationId: intent.correlationId ?? intent.id,
          interruptedByMessage: intent.messageText,
        });

        trackEvent({
          name: 'PolicyOverrideApplied',
          correlationId: intent.correlationId ?? intent.id,
          userId: intent.userId,
          properties: {
            authority: 'mind-session-guard-compatibility-mode',
            source: 'pending-intent-replay',
            activeInstanceId: guardState.activeInstanceId ?? 'unknown',
            requestedInstanceId: instanceId,
          },
        });
      }

      await client.startNew('overseer', { instanceId, input: event });
      await signalMindSessionAcquire(client, intent.userId, {
        instanceId,
        correlationId: intent.correlationId ?? intent.id,
        source,
      });
    } catch (error) {
      if (!isReplayConflict(error)) {
        throw error;
      }
    }

    await markIntentProcessed(intent.id, intent.userId);
    trackEvent({
      name: 'PendingIntentRecovered',
      correlationId: intent.correlationId ?? intent.id,
      userId: intent.userId,
      properties: {
        trackingId: intent.trackingId,
        action: 'replayed',
        reason: replayReason,
        source,
        instanceId,
      },
    });

    return { outcome: 'replayed', reason: replayReason, instanceId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markIntentReceived(intent.id, intent.userId, reason);
    trackEvent({
      name: 'PendingIntentRecovered',
      correlationId: intent.correlationId ?? intent.id,
      userId: intent.userId,
      properties: {
        trackingId: intent.trackingId,
        action: 'deferred',
        reason,
        source,
      },
    });
    return { outcome: 'deferred', reason };
  }
}