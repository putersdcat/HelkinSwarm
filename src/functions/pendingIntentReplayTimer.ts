// Pending Intent Replay Timer — replays queued turns into the overseer (#273).
// Runs every 5 minutes. Picks up intents that were queued when the overseer
// was unreachable and replays them via NewMessage event raise.
// Spec ref: ADDENDA-06, Issue #116, #273

import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import * as df from 'durable-functions';
import type { ConversationReference } from 'botbuilder';
import {
  getUnprocessedIntents,
  markIntentProcessing,
  markIntentProcessed,
  markIntentFailed,
  hasIdempotencyKey,
  type PendingIntent,
} from '../orchestrator/pendingIntentStore.js';
import { saveConversationReference } from '../bot/conversationStore.js';
import type { NewMessageEvent } from '../orchestrator/overseer.js';
import type { DevLoopContext } from '../devloop/radioProtocol.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Decision Matrix — determines how to handle each pending intent
// ---------------------------------------------------------------------------

function shouldAutoReplay(intent: PendingIntent): { replay: boolean; reason: string } {
  if (intent.riskLevel === 'high' || intent.riskLevel === 'critical') {
    return { replay: false, reason: 'High-risk intent requires live confirmation' };
  }
  if (intent.status === 'failed' && intent.failureReason) {
    return { replay: false, reason: `Previously failed: ${intent.failureReason}` };
  }
  return { replay: true, reason: 'Low-risk, eligible for auto-replay' };
}

// ---------------------------------------------------------------------------
// Timer — every 5 minutes
// ---------------------------------------------------------------------------

app.timer('pendingIntentReplayTimer', {
  schedule: '0 */5 * * * *', // Every 5 minutes
  extraInputs: [df.input.durableClient()],
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const client = df.getClient(context);

    const intents = await getUnprocessedIntents();
    if (intents.length === 0) return;

    context.log(`[pendingIntentReplay] Found ${intents.length} unprocessed intent(s)`);

    const stats = { replayed: 0, skipped: 0, failed: 0 };

    for (const intent of intents) {
      // Idempotency guard
      const alreadyDone = await hasIdempotencyKey(intent.idempotencyKey);
      if (alreadyDone) {
        stats.skipped++;
        continue;
      }

      const decision = shouldAutoReplay(intent);
      if (!decision.replay) {
        context.log(`[pendingIntentReplay] Skipping ${intent.trackingId}: ${decision.reason}`);
        stats.skipped++;
        continue;
      }

      try {
        await markIntentProcessing(intent.id, intent.userId);

        // Parse stored conversation reference
        const conversationReference = intent.conversationReferenceJson
          ? JSON.parse(intent.conversationReferenceJson) as ConversationReference
          : undefined;

        if (!conversationReference) {
          await markIntentFailed(intent.id, intent.userId, 'No conversation reference available');
          stats.failed++;
          continue;
        }

        // Save conversation reference so the overseer can reply
        await saveConversationReference(intent.userId, conversationReference);

        // Build the NewMessage event — same shape as the live bot path
        const devLoopContext = intent.devLoopContextJson
          ? JSON.parse(intent.devLoopContextJson) as DevLoopContext
          : undefined;

        const turnId = crypto.randomUUID().slice(0, 8);
        const instanceId = `overseer-${intent.userId}-${turnId}`;

        // The event is exactly the same shape as the live bot path
        const event: NewMessageEvent = {
          userMessage: intent.messageText,
          conversationReference,
          userId: intent.userId,
          userAlias: 'recovered-intent',
          ...(intent.modelOverride ? { modelOverride: intent.modelOverride } : {}),
          ...(intent.imageUrls.length > 0 ? { imageUrls: intent.imageUrls } : {}),
          ...(devLoopContext ? { devLoopContext } : {}),
        };

        await client.startNew('overseer', { instanceId, input: event });

        // Only mark processed AFTER successful delivery
        await markIntentProcessed(intent.id, intent.userId);
        stats.replayed++;

        trackEvent({
          name: 'PendingIntentRecovered',
          correlationId: intent.id,
          userId: intent.userId,
          properties: {
            trackingId: intent.trackingId,
            action: 'replayed',
            reason: decision.reason,
          },
        });

        context.log(`[pendingIntentReplay] Replayed ${intent.trackingId} → overseer-${intent.userId}`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        await markIntentFailed(intent.id, intent.userId, reason).catch(() => {});
        stats.failed++;
        context.log(`[pendingIntentReplay] Failed to replay ${intent.trackingId}: ${reason}`);
      }
    }

    if (stats.replayed > 0 || stats.failed > 0) {
      context.log(`[pendingIntentReplay] Complete: replayed=${stats.replayed}, skipped=${stats.skipped}, failed=${stats.failed}`);
    }
  },
});
