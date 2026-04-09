// Send Reply activity — sends the bot response back to Teams via proactive messaging.
// Spec ref: 10-Teams-Interface.md, 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import {
  ActivityTypes,
  type Attachment,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConversationReference,
} from 'botbuilder';
import {
  claimOutboundArtifact,
  getConversationReference,
  getPendingAckId,
  clearPendingAckId,
  releaseOutboundArtifactClaim,
  saveSentMessageText,
} from '../bot/conversationStore.js';
import { cacheSentMessage } from '../bot/sentMessageCache.js';
import { parseBooleanEnv } from '../config/booleanEnv.js';
import { getEnvConfig } from '../config/envConfig.js';
import { splitReplyIntoChunks } from './replyChunking.js';
import { trackEvent } from '../observability/telemetry.js';
import { clearOrchestratorStage, recordSubstage } from '../observability/orchestratorStageHealth.js';
import {
  recordMessagePathGlobalFailure,
  recordMessagePathSuccess,
} from '../observability/messagePathHealth.js';
import {
  loadRuntimeAssetReference,
  readRuntimeAssetContent,
  type RuntimeAssetReference,
} from '../integrations/runtimeAssetStore.js';
import { z } from 'zod';

export interface RuntimeReplyAssetInput {
  assetId: string;
  fileName?: string;
  contentType?: string;
}

export const RuntimeFileConsentContextSchema = z.object({
  assetId: z.string().uuid(),
  userId: z.string().min(1),
  correlationId: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
});
export type RuntimeFileConsentContext = z.infer<typeof RuntimeFileConsentContextSchema>;

export interface SendReplyInput {
  /** User AAD Object ID — used to look up ConversationReference from Cosmos. */
  userId: string;
  message: string;
  /** Runtime asset references to send as Teams attachments. */
  assets?: RuntimeReplyAssetInput[];
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
const CONTINUE_CONVERSATION_TIMEOUT_MS = 8_000;
const PENDING_ACK_CLEAR_TIMEOUT_MS = 2_000;

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

async function rememberSentMessage(
  userId: string,
  conversationId: string,
  activityId: string | undefined,
  text: string,
): Promise<void> {
  if (!activityId || !text) {
    return;
  }

  cacheSentMessage(activityId, text);
  try {
    await saveSentMessageText(userId, conversationId, activityId, text);
  } catch (err) {
    console.warn(
      `[sendReplyActivity] Failed to persist sent message text for activityId=${activityId}: ${err instanceof Error ? err.message : err}`,
    );
  }
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
const SENDREPLY_FAST_PATH = parseBooleanEnv(process.env['SENDREPLY_FAST_PATH']);

function buildDataUrl(contentType: string, bytes: Buffer): string {
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

function toTeamsAttachment(reference: RuntimeAssetReference, content: Buffer, override?: RuntimeReplyAssetInput): Attachment {
  const contentType = override?.contentType ?? reference.contentType;
  const name = override?.fileName ?? reference.fileName ?? `${reference.id}.${contentType.split('/')[1] ?? 'bin'}`;
  const contentUrl = buildDataUrl(contentType, content);

  return {
    contentType,
    contentUrl,
    name,
    ...(contentType.startsWith('image/') ? { thumbnailUrl: contentUrl } : {}),
  } satisfies Attachment;
}

function inferFileType(reference: RuntimeAssetReference): string {
  const fileName = reference.fileName ?? '';
  const fileExtension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : undefined;
  if (fileExtension && fileExtension.length > 0) {
    return fileExtension;
  }

  const contentSubtype = reference.contentType.split('/')[1]?.toLowerCase();
  if (contentSubtype && contentSubtype.length > 0) {
    return contentSubtype;
  }

  return 'bin';
}

function toFileConsentCard(reference: RuntimeAssetReference, correlationId: string, override?: RuntimeReplyAssetInput): Attachment {
  const fileName = override?.fileName ?? reference.fileName ?? `${reference.id}.${inferFileType(reference)}`;
  const context = RuntimeFileConsentContextSchema.parse({
    assetId: reference.id,
    userId: reference.userId,
    correlationId,
    fileName,
    contentType: override?.contentType ?? reference.contentType,
  });

  return {
    contentType: 'application/vnd.microsoft.teams.card.file.consent',
    name: fileName,
    content: {
      description: reference.summary ?? `Download ${fileName}`,
      sizeInBytes: reference.byteLength,
      acceptContext: context,
      declineContext: context,
    },
  } satisfies Attachment;
}

async function resolveAssetAttachments(input: SendReplyInput): Promise<Attachment[]> {
  if (!input.assets || input.assets.length === 0) {
    return [];
  }

  const attachments: Attachment[] = [];
  for (const asset of input.assets) {
    const reference = await loadRuntimeAssetReference({ userId: input.userId, assetId: asset.assetId });
    if (!reference) {
      throw new Error(`Runtime asset '${asset.assetId}' could not be resolved for reply send.`);
    }

    const effectiveContentType = asset.contentType ?? reference.contentType;
    if (effectiveContentType.startsWith('image/')) {
      const loaded = await readRuntimeAssetContent({
        userId: input.userId,
        assetId: asset.assetId,
      });
      if (!loaded) {
        throw new Error(`Runtime asset '${asset.assetId}' content could not be loaded for reply send.`);
      }
      attachments.push(toTeamsAttachment(loaded.reference, loaded.content, asset));
      continue;
    }

    attachments.push(toFileConsentCard(reference, input.correlationId ?? input.userId, asset));
  }

  return attachments;
}

export async function sendReply(input: SendReplyInput): Promise<SendReplyResult> {
  const correlationId = input.correlationId ?? input.userId;
  recordSubstage(correlationId, 'send-reply', input.userId);
  console.log(`[sendReplyActivity] START correlationId=${correlationId} fastPath=${SENDREPLY_FAST_PATH} hasPassthroughRef=${!!input.conversationReference}`);
  let deliveredToUser = false;
  let resolvedConversationId = input.userId;
  try {
    const replyChunks = splitReplyIntoChunks(input.message);
    const assetAttachments = await resolveAssetAttachments(input);

    const adapter = getAdapter();
    const appId = getEnvConfig().microsoftAppId;

    // Prefer the pass-through ConversationReference (avoids Cosmos read) (#327 diagnostic)
    const conversationReference = input.conversationReference
      ?? await getConversationReference(input.userId);
    if (!conversationReference) {
      throw new Error(`No ConversationReference found for userId=${input.userId}`);
    }
    const conversationId = (conversationReference as ConversationReference).conversation?.id ?? input.userId;
    resolvedConversationId = conversationId;

    let outboundClaimed = false;
    if (input.correlationId && !SENDREPLY_FAST_PATH) {
      outboundClaimed = await claimOutboundArtifact(
        conversationId,
        input.userId,
        'reply',
        input.correlationId,
      );
      if (!outboundClaimed) {
        console.warn(`[sendReplyActivity] Duplicate reply suppressed for correlationId=${input.correlationId}`);
        return { success: true };
      }
    }

    // In fast-path mode, skip Cosmos ack lookup and just send a new message
    const ackActivityId = SENDREPLY_FAST_PATH ? null
      : (input.correlationId ? await getPendingAckId(input.correlationId) : null);

    try {
      await withTimeout(
        adapter.continueConversationAsync(
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
                await rememberSentMessage(input.userId, conversationId, ackActivityId, replyChunks[0]!.text);
                firstChunkSent = true;
                deliveredToUser = true;
              } catch (err) {
                // Timeout means the update HTTP call is still in-flight and may yet succeed.
                // Sending a fallback message would cause a duplicate if the update completes (#329).
                const isTimeout = err instanceof Error && err.name === 'TimeoutError';
                if (isTimeout) {
                  console.warn(
                    `[sendReplyActivity] Ack update timed out for userId=${input.userId}; skipping fallback to avoid duplicate reply (#329)`,
                  );
                  // The in-flight update will likely complete — treat the first chunk as sent.
                  firstChunkSent = true;
                  deliveredToUser = true;
                } else {
                  console.warn(
                    `[sendReplyActivity] Ack update failed for userId=${input.userId}; falling back to new message send: ${err instanceof Error ? err.message : err}`,
                  );
                  const response = await turnContext.sendActivity({
                    type: ActivityTypes.Message,
                    text: replyChunks[0]!.text,
                    textFormat: 'markdown',
                  });
                  await rememberSentMessage(input.userId, conversationId, response?.id, replyChunks[0]!.text);
                  firstChunkSent = true;
                  deliveredToUser = true;
                }
              }

              for (const chunk of firstChunkSent ? replyChunks.slice(1) : replyChunks) {
                const response = await turnContext.sendActivity({
                  type: ActivityTypes.Message,
                  text: chunk.text,
                  textFormat: 'markdown',
                });
                await rememberSentMessage(input.userId, conversationId, response?.id, chunk.text);
                deliveredToUser = true;
              }

              if (assetAttachments.length > 0) {
                const response = await turnContext.sendActivity({
                  type: ActivityTypes.Message,
                  attachments: assetAttachments,
                });
                await rememberSentMessage(
                  input.userId,
                  conversationId,
                  response?.id,
                  `[attachment-message] ${assetAttachments.map((attachment) => attachment.name ?? attachment.contentType ?? 'attachment').join(', ')}`,
                );
                deliveredToUser = true;
              }
            } else {
              // No ack stored (e.g. first reply after container restart) — fall back to new message
              for (const chunk of replyChunks) {
                const response = await turnContext.sendActivity({
                  type: ActivityTypes.Message,
                  text: chunk.text,
                  textFormat: 'markdown',
                });
                await rememberSentMessage(input.userId, conversationId, response?.id, chunk.text);
                deliveredToUser = true;
              }

              if (assetAttachments.length > 0) {
                const response = await turnContext.sendActivity({
                  type: ActivityTypes.Message,
                  attachments: assetAttachments,
                });
                await rememberSentMessage(
                  input.userId,
                  conversationId,
                  response?.id,
                  `[attachment-message] ${assetAttachments.map((attachment) => attachment.name ?? attachment.contentType ?? 'attachment').join(', ')}`,
                );
                deliveredToUser = true;
              }
            }
          },
        ),
        CONTINUE_CONVERSATION_TIMEOUT_MS,
        'continue conversation',
      );
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      if (!(isTimeout && deliveredToUser)) {
        throw err;
      }

      console.warn(
        `[sendReplyActivity] continueConversationAsync timed out for userId=${input.userId}; continuing because visible reply delivery already completed`,
      );
    }

    if (ackActivityId && input.correlationId && !SENDREPLY_FAST_PATH) {
      try {
        await withTimeout(
          clearPendingAckId(conversationId, input.correlationId),
          PENDING_ACK_CLEAR_TIMEOUT_MS,
          'pending ack clear',
        );
      } catch (err) {
        console.warn(
          `[sendReplyActivity] Pending ack clear timed out/failed for userId=${input.userId}; continuing because the reply send already completed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    if (input.correlationId) {
      trackEvent({ name: 'ReplySent', correlationId: input.correlationId, userId: input.userId, properties: { success: 'true', chunks: String(replyChunks.length), attachments: String(assetAttachments.length) } });
      await recordMessagePathSuccess(input.correlationId);

      try {
        await clearOrchestratorStage(input.correlationId, input.userId);
      } catch (err) {
        console.warn(
          `[sendReplyActivity] Stage clear timed out/failed after visible reply delivery for userId=${input.userId}; continuing because the reply send already completed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    console.log(`[sendReplyActivity] DONE correlationId=${correlationId}`);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      if (input.correlationId && !deliveredToUser) {
        await releaseOutboundArtifactClaim(resolvedConversationId, 'reply', input.correlationId);
      }
    } catch {
      // Ignore cleanup failures — original send error is more important.
    }
    // Log prominently so it surfaces in Function App logs / Application Insights
    console.error('[sendReplyActivity] FATAL: Proactive reply to Teams failed:', message);
    if (input.correlationId) {
      trackEvent({ name: 'ReplySent', correlationId: input.correlationId, userId: input.userId, properties: { success: 'false', error: message } });
      await recordMessagePathGlobalFailure(`reply send failed: ${message}`);
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
