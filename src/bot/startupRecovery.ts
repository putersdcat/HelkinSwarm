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
} from './conversationStore.js';
import {
  getUnprocessedIntents,
  hasIdempotencyKey,
  markIntentExpired,
} from '../orchestrator/pendingIntentStore.js';
import { shouldAutoReplay } from '../orchestrator/pendingIntentReplay.js';
import { getEnvConfig } from '../config/envConfig.js';
import { recoverStaleAcks } from './staleAckRecovery.js';

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
 * Run startup recovery: clean up stale acks + replay pending intents.
 * Called from index.ts after a delay to allow the runtime to stabilize.
 */
export async function runStartupRecovery(): Promise<void> {
  const stats = { staleAcks: 0, intentsProcessed: 0, intentsSkipped: 0, intentsFailed: 0 };

  // --- Phase 1: Clean up stale pending acks (#191) ---
  try {
    const staleAckStats = await recoverStaleAcks();
    stats.staleAcks = staleAckStats.recovered;
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

      // #670 — reuse the shared auto-replay decision so we do not notify the
      // user about a queued replay that the timer will just refuse (high-risk,
      // previously-failed, or expired by age). When the intent is age-expired,
      // tombstone it here so it is not re-surfaced on every deploy restart.
      const decision = shouldAutoReplay(intent);
      if (!decision.replay) {
        stats.intentsSkipped++;
        if (decision.reason.startsWith('Intent expired')) {
          try {
            await markIntentExpired(intent.id, intent.userId, decision.reason);
          } catch (tombstoneErr) {
            console.warn(
              `[startupRecovery] Failed to tombstone expired intent ${intent.trackingId}:`,
              tombstoneErr,
            );
          }
        }
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
