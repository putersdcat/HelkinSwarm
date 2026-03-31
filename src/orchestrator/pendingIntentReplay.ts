// Pending intent replay helpers — shared by the replay timer and wake-up queue path.

import type { DurableClient } from 'durable-functions';
import type { ConversationReference } from 'botbuilder';
import { saveConversationReference } from '../bot/conversationStore.js';
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
      await client.startNew('overseer', { instanceId, input: event });
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
        reason: decision.reason,
        source,
        instanceId,
      },
    });

    return { outcome: 'replayed', reason: decision.reason, instanceId };
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