// Startup Recovery — cleans up dangling acks and replays pending intents on container start.
// Spec ref: ADDENDA-06, Issue #116, #191
/* eslint-disable no-console */

import {
  ActivityTypes,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
} from 'botbuilder';
import {
  getConversationReference,
  getStaleAcks,
  clearPendingAckId,
} from './conversationStore.js';
import {
  getUnprocessedIntents,
  markIntentProcessing,
  markIntentProcessed,
  markIntentFailed,
  hasIdempotencyKey,
} from '../orchestrator/pendingIntentStore.js';
import { getEnvConfig } from '../config/envConfig.js';
import { trackEvent } from '../observability/telemetry.js';

// Stale ack threshold — acks older than this are considered dangling (5 minutes)
const STALE_ACK_THRESHOLD_MS = 5 * 60 * 1000;

let adapterInstance: CloudAdapter | undefined;

function getAdapter(): CloudAdapter {
  if (!adapterInstance) {
    const env = getEnvConfig();
    const auth = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: env.microsoftAppId,
      MicrosoftAppType: 'UserAssignedMSI',
      MicrosoftAppTenantId: env.microsoftAppTenantId,
    });
    adapterInstance = new CloudAdapter(auth);
  }
  return adapterInstance;
}

/**
 * Replace a dangling "⌛ Working on it..." ack with a recovery message.
 * Called on startup if stale ack documents are found in Cosmos.
 */
async function recoverStaleAck(
  userId: string,
  conversationId: string,
  ackActivityId: string,
): Promise<void> {
  const adapter = getAdapter();
  const appId = getEnvConfig().microsoftAppId;
  const conversationReference = await getConversationReference(userId);

  if (!conversationReference) {
    // No conversation reference — can only clear the ack document
    await clearPendingAckId(userId, conversationId);
    return;
  }

  await adapter.continueConversationAsync(
    appId,
    conversationReference as ConversationReference,
    async (turnContext) => {
      await turnContext.updateActivity({
        type: ActivityTypes.Message,
        id: ackActivityId,
        text: '⚠️ Your previous message was interrupted by a service restart. Please resend it if you still need a response.',
        textFormat: 'markdown',
      });
    },
  );

  await clearPendingAckId(userId, conversationId);
}

/**
 * Run startup recovery: clean up stale acks + replay pending intents.
 * Called from index.ts after a delay to allow the runtime to stabilize.
 */
export async function runStartupRecovery(): Promise<void> {
  const stats = { staleAcks: 0, intentsProcessed: 0, intentsSkipped: 0, intentsFailed: 0 };

  // --- Phase 1: Clean up stale pending acks (#191) ---
  try {
    const staleAcks = await getStaleAcks(STALE_ACK_THRESHOLD_MS);

    for (const ack of staleAcks) {
      try {
        await recoverStaleAck(ack.userId, ack.conversationId, ack.activityId);
        stats.staleAcks++;
        trackEvent({
          name: 'StaleAckRecovered',
          correlationId: ack.activityId,
          userId: ack.userId,
          properties: { ackActivityId: ack.activityId },
        });
      } catch (err) {
        // Individual ack recovery failure — clear the document anyway to avoid infinite retry
        console.warn(`[startupRecovery] Failed to recover stale ack for userId=${ack.userId}:`, err);
        try {
          await clearPendingAckId(ack.userId, ack.conversationId);
        } catch {
          // Nothing more we can do
        }
      }
    }
  } catch (err) {
    console.warn('[startupRecovery] Stale ack query failed:', err);
  }

  // --- Phase 2: Replay pending intents (#116) ---
  try {
    const intents = await getUnprocessedIntents();

    for (const intent of intents) {
      // Dedup check
      const alreadyDone = await hasIdempotencyKey(intent.idempotencyKey);
      if (alreadyDone) {
        stats.intentsSkipped++;
        continue;
      }

      // Safety: skip high-risk intents — they need live confirmation
      if (intent.riskLevel === 'high' || intent.riskLevel === 'critical') {
        stats.intentsSkipped++;
        continue;
      }

      // Skip previously failed intents
      if (intent.status === 'failed' && intent.failureReason) {
        stats.intentsSkipped++;
        continue;
      }

      try {
        await markIntentProcessing(intent.id, intent.userId);

        // Notify user that their queued message is being processed
        const conversationReference = intent.conversationReferenceJson
          ? JSON.parse(intent.conversationReferenceJson) as ConversationReference
          : await getConversationReference(intent.userId);

        if (conversationReference) {
          const adapter = getAdapter();
          const appId = getEnvConfig().microsoftAppId;

          await adapter.continueConversationAsync(
            appId,
            conversationReference as ConversationReference,
            async (turnContext) => {
              await turnContext.sendActivity({
                type: ActivityTypes.Message,
                text: `🔄 Processing your queued message (tracking: ${intent.trackingId}): "${intent.messageText.slice(0, 100)}${intent.messageText.length > 100 ? '...' : ''}"`,
                textFormat: 'markdown',
              });
            },
          );
        }

        // TODO: Route to overseer via raiseEvent once startup orchestrator wiring is in place.
        // For now, we notify the user and mark as processed.
        await markIntentProcessed(intent.id, intent.userId);
        stats.intentsProcessed++;

        trackEvent({
          name: 'PendingIntentRecovered',
          correlationId: intent.id,
          userId: intent.userId,
          properties: { trackingId: intent.trackingId },
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Unknown error';
        await markIntentFailed(intent.id, intent.userId, reason).catch(() => {});
        stats.intentsFailed++;
      }
    }
  } catch (err) {
    console.warn('[startupRecovery] Pending intent query failed:', err);
  }

  if (stats.staleAcks > 0 || stats.intentsProcessed > 0 || stats.intentsFailed > 0) {
    console.log(
      `[startupRecovery] Recovery complete: ${stats.staleAcks} stale acks cleared, ` +
      `${stats.intentsProcessed} intents processed, ${stats.intentsSkipped} skipped, ` +
      `${stats.intentsFailed} failed`,
    );
  }
}
