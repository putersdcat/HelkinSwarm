// Startup Recovery — cleans up dangling acks and notifies users about pending intents.
// Actual intent replay is handled by pendingIntentReplayTimer (#273).
// Spec ref: ADDENDA-06, Issue #116, #191, #273
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

  // --- Phase 2: Notify users about pending intents (#116, #273) ---
  // Actual replay into the overseer is handled by pendingIntentReplayTimer,
  // which has DurableClient access. This phase only sends user notifications.
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
        // Notify user that their queued message will be replayed
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
                text: `🔄 Replaying your queued message (tracking: ${intent.trackingId}): "${intent.messageText.slice(0, 100)}${intent.messageText.length > 100 ? '...' : ''}"`,
                textFormat: 'markdown',
              });
            },
          );
        }

        stats.intentsProcessed++;
      } catch (err) {
        // Notification failure is non-fatal — the timer will still replay the intent
        console.warn(`[startupRecovery] Failed to notify user about intent ${intent.trackingId}:`, err);
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
