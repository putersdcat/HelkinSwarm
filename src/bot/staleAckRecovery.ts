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
import { getEnvConfig } from '../config/envConfig.js';
import { trackEvent } from '../observability/telemetry.js';
import { clearOrchestratorStage } from '../observability/orchestratorStageHealth.js';

export const STALE_ACK_THRESHOLD_MS = 5 * 60 * 1000;

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

export interface StaleAckRecoveryStats {
  recovered: number;
  clearedWithoutReference: number;
  failed: number;
}

async function clearRecoveredTurnArtifacts(
  conversationId: string,
  correlationId: string,
  userId: string,
): Promise<void> {
  try {
    await clearPendingAckId(conversationId, correlationId);
  } finally {
    await clearOrchestratorStage(correlationId, userId);
  }
}

export async function recoverStaleAck(
  conversationId: string,
  ackActivityId: string,
  userId: string,
  correlationId: string,
  conversationReferenceOverride?: Partial<ConversationReference> | null,
): Promise<'recovered' | 'cleared-without-reference'> {
  const adapter = getAdapter();
  const appId = getEnvConfig().microsoftAppId;
  const conversationReference = conversationReferenceOverride
    ?? await getConversationReference(userId);

  if (!conversationReference) {
    await clearRecoveredTurnArtifacts(conversationId, correlationId, userId);
    return 'cleared-without-reference';
  }

  await adapter.continueConversationAsync(
    appId,
    conversationReference as ConversationReference,
    async (turnContext) => {
      await turnContext.updateActivity({
        type: ActivityTypes.Message,
        id: ackActivityId,
        text: '⚠️ This turn was interrupted before a final reply could be delivered. Please resend it if you still need a response.',
        textFormat: 'markdown',
      });
    },
  );

  await clearRecoveredTurnArtifacts(conversationId, correlationId, userId);
  return 'recovered';
}

export async function recoverStaleAcks(maxAgeMs = STALE_ACK_THRESHOLD_MS): Promise<StaleAckRecoveryStats> {
  const staleAcks = await getStaleAcks(maxAgeMs);
  const stats: StaleAckRecoveryStats = {
    recovered: 0,
    clearedWithoutReference: 0,
    failed: 0,
  };

  for (const ack of staleAcks) {
    try {
      const outcome = await recoverStaleAck(
        ack.conversationId,
        ack.activityId,
        ack.userId,
        ack.correlationId,
      );

      if (outcome === 'recovered') {
        stats.recovered++;
      } else {
        stats.clearedWithoutReference++;
      }

      trackEvent({
        name: 'StaleAckRecovered',
        correlationId: ack.correlationId,
        userId: ack.userId,
        properties: {
          ackActivityId: ack.activityId,
          outcome,
        },
      });
    } catch (err) {
      stats.failed++;
      try {
        await clearRecoveredTurnArtifacts(ack.conversationId, ack.correlationId, ack.userId);
      } catch {
        // Nothing more we can do.
      }
      console.warn(`[staleAckRecovery] Failed to recover stale ack for userId=${ack.userId}:`, err);
    }
  }

  return stats;
}