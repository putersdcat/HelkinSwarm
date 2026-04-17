// Pending intent replay helpers — shared by the replay timer and wake-up queue path.

import type { DurableClient } from 'durable-functions';
import type { ConversationReference } from 'botbuilder';
import { saveConversationReference } from '../bot/conversationStore.js';
import { getEnvConfig } from '../config/envConfig.js';
import type { DevLoopContext } from '../devloop/radioProtocol.js';
import { getActiveTurnCountForUser } from '../observability/orchestratorStageHealth.js';
import { trackEvent } from '../observability/telemetry.js';
import { resolveActiveOverseerSummary } from './activeOverseerInstance.js';
import {
  classifyRequestedTaskComplexity,
  getConsciousLaneAssessmentForTurn,
} from '../llm/modelRouter.js';
import {
  hasIdempotencyKey,
  markIntentExpired,
  markIntentFailed,
  markIntentProcessed,
  markIntentProcessing,
  markIntentReceived,
  type PendingIntent,
} from './pendingIntentStore.js';
import { recordLimbicIngressDecision } from './limbicIngressActivity.js';
import {
  MAX_INTERRUPTION_DEPTH,
  readMindSessionGuardState,
  signalMindSessionAcquire,
} from './mindSessionGuard.js';
import type { NewMessageEvent } from './overseer.js';
import { sendReply } from './sendReplyActivity.js';
import {
  saveChronoInterruptionBreadcrumb,
  saveChronoPausedTask,
} from './chronoBackplane.js';

export interface PendingIntentReplayDecision {
  replay: boolean;
  reason: string;
}

export interface PendingIntentReplayResult {
  outcome: 'replayed' | 'skipped' | 'deferred' | 'failed';
  reason: string;
  instanceId?: string;
}

export function shouldAutoReplay(intent: PendingIntent, now: number = Date.now()): PendingIntentReplayDecision {
  if (intent.riskLevel === 'high' || intent.riskLevel === 'critical') {
    return { replay: false, reason: 'High-risk intent requires live confirmation' };
  }
  if (intent.status === 'failed' && intent.failureReason) {
    return { replay: false, reason: `Previously failed: ${intent.failureReason}` };
  }
  // #670 — freshness gate. Stale queued intents must not replay across deploy restarts
  // after the operator has moved on or manually killed the original session. Default
  // cutoff is 2 hours; overridable via PENDING_INTENT_MAX_AGE_HOURS.
  const maxAgeHours = Number.parseFloat(process.env.PENDING_INTENT_MAX_AGE_HOURS ?? '2');
  if (Number.isFinite(maxAgeHours) && maxAgeHours > 0) {
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const createdMs = Date.parse(intent.timestamp);
    if (Number.isFinite(createdMs) && now - createdMs > maxAgeMs) {
      const ageHours = ((now - createdMs) / 3_600_000).toFixed(1);
      return { replay: false, reason: `Intent expired (age ${ageHours}h > max ${maxAgeHours}h)` };
    }
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
    // #670 — if the skip reason is age-based expiry, tombstone the intent so it will
    // not keep being picked up by getUnprocessedIntents on every subsequent sweep.
    if (decision.reason.startsWith('Intent expired')) {
      try {
        await markIntentExpired(intent.id, intent.userId, decision.reason);
      } catch (tombstoneErr) {
        // Non-fatal: the replay is still suppressed for this turn; worst case the
        // intent gets evaluated again on the next sweep and stays skipped.
        const msg = tombstoneErr instanceof Error ? tombstoneErr.message : String(tombstoneErr);
        trackEvent({
          name: 'PendingIntentRecovered',
          correlationId: intent.correlationId ?? intent.id,
          properties: { phase: 'expired-tombstone-failed', source, error: msg.slice(0, 200) },
        });
      }
    }
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
      const activeSummary = await resolveActiveOverseerSummary(client, intent.userId);
      const activeTurnCount = await getActiveTurnCountForUser(intent.userId);
      const effectiveActiveInstanceId = activeSummary.latestInstanceId;
      const hasActiveGuard = activeSummary.activeCount > 0 && effectiveActiveInstanceId !== instanceId;
      const activeSessionRoutable = hasActiveGuard && effectiveActiveInstanceId !== undefined;
      const interruptionDepth = Math.max(
        guardState?.interruptionDepth ?? 0,
        Math.max(0, activeTurnCount - 1),
      );
      const consciousLane = getConsciousLaneAssessmentForTurn(intent.modelOverride);
      const requestedTaskComplexity = classifyRequestedTaskComplexity({
        userMessage: intent.messageText,
        modelOverride: intent.modelOverride,
        runtimeAssetCount: intent.runtimeAssets.length,
        hasDevLoopContext: devLoopContext !== undefined,
      });

      const ingressDecision = recordLimbicIngressDecision({
        source: 'pending-intent-replay',
        userId: intent.userId,
        correlationId: intent.correlationId ?? intent.id,
        compatibilityMode: getEnvConfig().livingMindCompatibilityMode,
        hasActiveSession: hasActiveGuard,
        activeSessionRoutable,
        interruptionDepth,
        interruptionDepthCap: MAX_INTERRUPTION_DEPTH,
        consciousModelImpaired: consciousLane.isImpaired,
        requestedTaskComplexity,
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

      if (ingressDecision.decision === 'defer') {
        await markIntentReceived(intent.id, intent.userId, ingressDecision.reason);
        await sendReply({
          userId: intent.userId,
          correlationId: intent.correlationId ?? intent.id,
          conversationReference,
          message: '⚠️ I deferred replay of your queued heavier turn because the conscious lane is currently low-capacity. I will keep it queued for later recovery, or you can retry with /heavy for full reasoning.',
        });
        trackEvent({
          name: 'PendingIntentRecovered',
          correlationId: intent.correlationId ?? intent.id,
          userId: intent.userId,
          properties: {
            trackingId: intent.trackingId,
            action: 'deferred',
            reason: ingressDecision.reason,
            source,
            requestedTaskComplexity,
          },
        });
        return { outcome: 'deferred', reason: ingressDecision.reason };
      }

      if (activeSessionRoutable && effectiveActiveInstanceId) {
        trackEvent({
          name: 'PolicyOverrideApplied',
          correlationId: intent.correlationId ?? intent.id,
          userId: intent.userId,
          properties: {
            authority: 'living-session-active-redirection',
            source: 'pending-intent-replay',
            activeInstanceId: effectiveActiveInstanceId,
            requestedInstanceId: instanceId,
            interruptionDepth,
          },
        });

        await client.raiseEvent(effectiveActiveInstanceId, 'NewMessage', event);
        await markIntentProcessed(intent.id, intent.userId);

        // Record interruption breadcrumb + paused task for Chrono-Backplane (#494 AC 4)
        const replayCorrelationId = intent.correlationId ?? intent.id;
        await saveChronoInterruptionBreadcrumb({
          userId: intent.userId,
          interruptedInstanceId: effectiveActiveInstanceId,
          interruptedCorrelationId: undefined,
          interruptedSource: 'pending-intent-replay',
          interruptedByCorrelationId: replayCorrelationId,
          interruptedByMessage: intent.messageText,
        });
        await saveChronoPausedTask({
          userId: intent.userId,
          interruptedInstanceId: effectiveActiveInstanceId,
          interruptedCorrelationId: undefined,
          interruptedSource: 'pending-intent-replay',
          pausedByCorrelationId: replayCorrelationId,
          pausedByMessage: intent.messageText,
        });

        trackEvent({
          name: 'PendingIntentRecovered',
          correlationId: intent.correlationId ?? intent.id,
          userId: intent.userId,
          properties: {
            trackingId: intent.trackingId,
            action: 'redirected',
            reason: ingressDecision.reason,
            source,
            instanceId: effectiveActiveInstanceId,
          },
        });
        return { outcome: 'replayed', reason: ingressDecision.reason, instanceId: effectiveActiveInstanceId };
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