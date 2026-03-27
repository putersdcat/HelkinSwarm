// Send Reply activity — sends the bot response back to Teams via proactive messaging.
// Spec ref: 10-Teams-Interface.md, 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import {
  ActivityTypes,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
} from 'botbuilder';
import {
  getConversationReference,
  getPendingAckId,
  clearPendingAckId,
} from '../bot/conversationStore.js';
import { cacheSentMessage } from '../bot/sentMessageCache.js';
import { getEnvConfig } from '../config/envConfig.js';
import { splitReplyIntoChunks } from './replyChunking.js';
import { trackEvent } from '../observability/telemetry.js';
import { clearOrchestratorStage, recordOrchestratorStage } from '../observability/orchestratorStageHealth.js';

export interface SendReplyInput {
  /** User AAD Object ID — used to look up ConversationReference from Cosmos. */
  userId: string;
  message: string;
  /** Correlation ID for tracing (#269). */
  correlationId?: string;
}

export interface SendReplyResult {
  success: boolean;
  error?: string;
}

// Shared adapter instance for proactive messaging.
// Uses the UAMI credentials from the Bot Service registration.
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

export async function sendReply(input: SendReplyInput): Promise<SendReplyResult> {
  const correlationId = input.correlationId ?? input.userId;
  recordOrchestratorStage(correlationId, 'send-reply', input.userId);
  try {
    const replyChunks = splitReplyIntoChunks(input.message);

    const adapter = getAdapter();
    const appId = getEnvConfig().microsoftAppId;

    // Read ConversationReference from Cosmos (survives container restarts)
    const conversationReference = await getConversationReference(input.userId);
    if (!conversationReference) {
      throw new Error(`No ConversationReference found in Cosmos for userId=${input.userId}`);
    }

    const ackActivityId = input.correlationId
      ? await getPendingAckId(input.correlationId)
      : null;

    await adapter.continueConversationAsync(
      appId,
      conversationReference as ConversationReference,
      async (turnContext) => {
        if (ackActivityId) {
          // Replace the "⌛ Working on it..." placeholder in-place (spec: 10-Teams-Interface.md)
          await turnContext.updateActivity({
            type: ActivityTypes.Message,
            id: ackActivityId,
            text: replyChunks[0]!.text,
            textFormat: 'markdown',
          });
          // Cache under ack ID so reply-with-quote can resolve full text (#166)
          cacheSentMessage(ackActivityId, replyChunks[0]!.text);
          const conversationId = (conversationReference as ConversationReference).conversation?.id ?? input.userId;
          if (input.correlationId) {
            await clearPendingAckId(conversationId, input.correlationId);
          }

          for (const chunk of replyChunks.slice(1)) {
            const response = await turnContext.sendActivity({
              type: ActivityTypes.Message,
              text: chunk.text,
              textFormat: 'markdown',
            });
            if (response?.id) {
              cacheSentMessage(response.id, chunk.text);
            }
          }
        } else {
          // No ack stored (e.g. first reply after container restart) — fall back to new message
          for (const chunk of replyChunks) {
            const response = await turnContext.sendActivity({
              type: ActivityTypes.Message,
              text: chunk.text,
              textFormat: 'markdown',
            });
            if (response?.id) {
              cacheSentMessage(response.id, chunk.text);
            }
          }
        }
      },
    );
    if (input.correlationId) {
      trackEvent({ name: 'ReplySent', correlationId: input.correlationId, userId: input.userId, properties: { success: 'true', chunks: String(replyChunks.length) } });
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Log prominently so it surfaces in Function App logs / Application Insights
    console.error('[sendReplyActivity] FATAL: Proactive reply to Teams failed:', message);
    if (input.correlationId) {
      trackEvent({ name: 'ReplySent', correlationId: input.correlationId, userId: input.userId, properties: { success: 'false', error: message } });
    }
    // Throw so the Durable activity is marked failed and the failure is visible
    // in orchestration history. Let the overseer handle the failure cleanly.
    throw new Error(`Proactive reply failed: ${message}`);
  } finally {
    clearOrchestratorStage(correlationId);
  }
}

df.app.activity('sendReplyActivity', {
  handler: async (input: SendReplyInput): Promise<SendReplyResult> => {
    return sendReply(input);
  },
});
