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
import { clearOrchestratorStage, recordSubstage } from '../observability/orchestratorStageHealth.js';

export interface SendReplyInput {
  /** User AAD Object ID — used to look up ConversationReference from Cosmos. */
  userId: string;
  message: string;
  /** Correlation ID for tracing (#269). */
  correlationId?: string;
  /** Pass-through ConversationReference to avoid Cosmos read (#327 diagnostic). */
  conversationReference?: Partial<ConversationReference>;
}

export interface SendReplyResult {
  success: boolean;
  error?: string;
}

// Shared adapter instance for proactive messaging.
// Uses the UAMI credentials from the Bot Service registration.
let adapterInstance: CloudAdapter | undefined;
const ACK_UPDATE_TIMEOUT_MS = 3_000;

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`${label} timed out after ${timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        reject(timeoutError);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

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

// DIAGNOSTIC (#327): Skip Cosmos reads when fast-path is active
const SENDREPLY_FAST_PATH = !!(process.env['SENDREPLY_FAST_PATH'] ?? '1');

export async function sendReply(input: SendReplyInput): Promise<SendReplyResult> {
  const correlationId = input.correlationId ?? input.userId;
  recordSubstage(correlationId, 'send-reply', input.userId);
  console.log(`[sendReplyActivity] START correlationId=${correlationId} fastPath=${SENDREPLY_FAST_PATH} hasPassthroughRef=${!!input.conversationReference}`);
  try {
    const replyChunks = splitReplyIntoChunks(input.message);

    const adapter = getAdapter();
    const appId = getEnvConfig().microsoftAppId;

    // Prefer the pass-through ConversationReference (avoids Cosmos read) (#327 diagnostic)
    const conversationReference = input.conversationReference
      ?? await getConversationReference(input.userId);
    if (!conversationReference) {
      throw new Error(`No ConversationReference found for userId=${input.userId}`);
    }

    // In fast-path mode, skip Cosmos ack lookup and just send a new message
    const ackActivityId = SENDREPLY_FAST_PATH ? null
      : (input.correlationId ? await getPendingAckId(input.correlationId) : null);

    await adapter.continueConversationAsync(
      appId,
      conversationReference as ConversationReference,
      async (turnContext) => {
        if (ackActivityId) {
          let firstChunkSent = false;
          try {
            // Replace the "⌛ Working on it..." placeholder in-place when Teams cooperates.
            await withTimeout(turnContext.updateActivity({
              type: ActivityTypes.Message,
              id: ackActivityId,
              text: replyChunks[0]!.text,
              textFormat: 'markdown',
            }), ACK_UPDATE_TIMEOUT_MS, 'ack update');
            // Cache under ack ID so reply-with-quote can resolve full text (#166)
            cacheSentMessage(ackActivityId, replyChunks[0]!.text);
            firstChunkSent = true;
          } catch (err) {
            console.warn(
              `[sendReplyActivity] Ack update failed for userId=${input.userId}; falling back to new message send: ${err instanceof Error ? err.message : err}`,
            );
            const response = await turnContext.sendActivity({
              type: ActivityTypes.Message,
              text: replyChunks[0]!.text,
              textFormat: 'markdown',
            });
            if (response?.id) {
              cacheSentMessage(response.id, replyChunks[0]!.text);
            }
            firstChunkSent = true;
          }

          const conversationId = (conversationReference as ConversationReference).conversation?.id ?? input.userId;
          if (input.correlationId && !SENDREPLY_FAST_PATH) {
            await clearPendingAckId(conversationId, input.correlationId);
          }

          for (const chunk of firstChunkSent ? replyChunks.slice(1) : replyChunks) {
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
    if (!SENDREPLY_FAST_PATH) {
      await clearOrchestratorStage(correlationId, input.userId);
    }
    console.log(`[sendReplyActivity] DONE correlationId=${correlationId}`);
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
  }
}

df.app.activity('sendReplyActivity', {
  handler: async (input: SendReplyInput): Promise<SendReplyResult> => {
    return sendReply(input);
  },
});
