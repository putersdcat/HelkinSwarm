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
  hasOutboundArtifactClaim,
} from './conversationStore.js';
import { getEnvConfig } from '../config/envConfig.js';
import { trackEvent } from '../observability/telemetry.js';
import {
  clearOrchestratorStage,
  getOrchestratorStageForCorrelation,
} from '../observability/orchestratorStageHealth.js';
import { formatTelemetryTimestamp } from '../orchestrator/turnTelemetry.js';

export const STALE_ACK_THRESHOLD_MS = 6 * 60 * 1000;

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
  skipped: number;
  failed: number;
}

function buildStaleAckRecoveryMessage(correlationId: string, recoveredAtIso = new Date().toISOString()): string {
  const shortCorrelationId = correlationId.slice(0, 8);
  const timestamp = formatTelemetryTimestamp(recoveredAtIso) ?? recoveredAtIso;
  return `⚠️ The initial ack placeholder aged out before a final reply was confirmed. This turn may still complete later; if no real reply arrives, resend it. \`[path:stale-ack-recovery|ts:${timestamp}|corr:${shortCorrelationId}]\``;
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
): Promise<'recovered' | 'skipped'> {
  const recoveredAtIso = new Date().toISOString();
  const [stageForCorrelation, replyClaimExists] = await Promise.all([
    getOrchestratorStageForCorrelation(correlationId, userId),
    hasOutboundArtifactClaim(conversationId, 'reply', correlationId),
  ]);

  if (stageForCorrelation || replyClaimExists) {
    return 'skipped';
  }

  const adapter = getAdapter();
  const appId = getEnvConfig().microsoftAppId;
  const conversationReference = conversationReferenceOverride
    ?? await getConversationReference(userId);

  if (!conversationReference) {
    return 'skipped';
  }

  await adapter.continueConversationAsync(
    appId,
    conversationReference as ConversationReference,
    async (turnContext) => {
      await turnContext.updateActivity({
        type: ActivityTypes.Message,
        id: ackActivityId,
        text: buildStaleAckRecoveryMessage(correlationId, recoveredAtIso),
        textFormat: 'markdown',
      });
    },
  );

  trackEvent({
    name: 'StaleAckRecoveryMessageEdited',
    correlationId,
    userId,
    properties: {
      conversationId,
      ackActivityId,
      recoveredAt: recoveredAtIso,
    },
  });

  await clearRecoveredTurnArtifacts(conversationId, correlationId, userId);
  return 'recovered';
}

export async function recoverStaleAcks(maxAgeMs = STALE_ACK_THRESHOLD_MS): Promise<StaleAckRecoveryStats> {
  const staleAcks = await getStaleAcks(maxAgeMs);
  const stats: StaleAckRecoveryStats = {
    recovered: 0,
    skipped: 0,
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
        stats.skipped++;
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
      console.warn(`[staleAckRecovery] Failed to recover stale ack for userId=${ack.userId}:`, err);
    }
  }

  return stats;
}