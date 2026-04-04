import * as df from 'durable-functions';
import { z } from 'zod';
import { getContainer } from '../memory/cosmosClient.js';
import type { NewMessageEvent } from './overseer.js';
import { RuntimeAssetReferenceSchema } from '../integrations/runtimeAssetStore.js';
import { trackEvent } from '../observability/telemetry.js';

const SESSIONS_CONTAINER = 'sessions';
const BUFFERED_NEW_MESSAGE_TYPE = 'buffered-new-message';
const BUFFERED_NEW_MESSAGE_TTL_SECONDS = 15 * 60;

const BufferedIngressActivityInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('dequeue-new-message'),
    userId: z.string().min(1),
  }),
]);

export type BufferedIngressActivityInput = z.infer<typeof BufferedIngressActivityInputSchema>;

const BufferedNewMessageDocumentSchema = z.object({
  id: z.string().min(1),
  type: z.literal(BUFFERED_NEW_MESSAGE_TYPE),
  status: z.enum(['queued', 'dequeued', 'replayed']).default('queued'),
  userId: z.string().min(1),
  userAlias: z.string().min(1),
  correlationId: z.string().min(1),
  userMessage: z.string().min(1),
  queuedAt: z.string().min(1),
  dequeuedAt: z.string().min(1).optional(),
  replayedAt: z.string().min(1).optional(),
  replayedInstanceId: z.string().min(1).optional(),
  targetInstanceId: z.string().min(1).optional(),
  conversationReferenceJson: z.string().min(1).optional(),
  modelOverride: z.string().min(1).optional(),
  imageUrls: z.array(z.string()).default([]),
  runtimeAssets: z.array(RuntimeAssetReferenceSchema).default([]),
  attachmentNotices: z.array(z.string()).default([]),
  devLoopContextJson: z.string().min(1).optional(),
  correlationTag: z.string().min(1).optional(),
  quotedContextJson: z.string().min(1).optional(),
  ttl: z.number().int().positive().default(BUFFERED_NEW_MESSAGE_TTL_SECONDS),
});

type BufferedNewMessageDocument = z.infer<typeof BufferedNewMessageDocumentSchema>;

export type BufferedIngressStatus = BufferedNewMessageDocument['status'];

export interface BufferedIngressDocumentSummary {
  docId: string;
  userId: string;
  correlationId: string;
  status: BufferedIngressStatus;
  queuedAt: string;
  dequeuedAt?: string;
  replayedAt?: string;
  replayedInstanceId?: string;
  targetInstanceId?: string;
}

export interface BufferedQueuedReplayCandidate {
  docId: string;
  userId: string;
  correlationId: string;
  event: NewMessageEvent;
}

function toNewMessageEvent(doc: BufferedNewMessageDocument): NewMessageEvent {
  return {
    userMessage: doc.userMessage,
    conversationReference: doc.conversationReferenceJson
      ? JSON.parse(doc.conversationReferenceJson) as NewMessageEvent['conversationReference']
      : undefined,
    userId: doc.userId,
    userAlias: doc.userAlias,
    correlationId: doc.correlationId,
    ...(doc.modelOverride ? { modelOverride: doc.modelOverride } : {}),
    ...(doc.imageUrls.length > 0 ? { imageUrls: doc.imageUrls } : {}),
    ...(doc.runtimeAssets.length > 0 ? { runtimeAssets: doc.runtimeAssets } : {}),
    ...(doc.attachmentNotices.length > 0 ? { attachmentNotices: doc.attachmentNotices } : {}),
    ...(doc.devLoopContextJson
      ? { devLoopContext: JSON.parse(doc.devLoopContextJson) as NewMessageEvent['devLoopContext'] }
      : {}),
    ...(doc.correlationTag ? { correlationTag: doc.correlationTag } : {}),
    ...(doc.quotedContextJson
      ? { quotedContext: JSON.parse(doc.quotedContextJson) as NewMessageEvent['quotedContext'] }
      : {}),
  } satisfies NewMessageEvent;
}

function toBufferedIngressDocumentSummary(doc: BufferedNewMessageDocument): BufferedIngressDocumentSummary {
  return {
    docId: doc.id,
    userId: doc.userId,
    correlationId: doc.correlationId,
    status: doc.status,
    queuedAt: doc.queuedAt,
    ...(doc.dequeuedAt ? { dequeuedAt: doc.dequeuedAt } : {}),
    ...(doc.replayedAt ? { replayedAt: doc.replayedAt } : {}),
    ...(doc.replayedInstanceId ? { replayedInstanceId: doc.replayedInstanceId } : {}),
    ...(doc.targetInstanceId ? { targetInstanceId: doc.targetInstanceId } : {}),
  } satisfies BufferedIngressDocumentSummary;
}

export async function queueBufferedNewMessage(
  event: NewMessageEvent,
  userId: string,
  targetInstanceId?: string,
): Promise<void> {
  const correlationId = event.correlationId ?? crypto.randomUUID();
  const doc = BufferedNewMessageDocumentSchema.parse({
    id: `buffered-new-message-${correlationId}`,
    type: BUFFERED_NEW_MESSAGE_TYPE,
    status: 'queued',
    userId,
    userAlias: event.userAlias,
    correlationId,
    userMessage: event.userMessage,
    queuedAt: new Date().toISOString(),
    targetInstanceId,
    conversationReferenceJson: event.conversationReference
      ? JSON.stringify(event.conversationReference)
      : undefined,
    modelOverride: event.modelOverride,
    imageUrls: event.imageUrls ?? [],
    runtimeAssets: event.runtimeAssets ?? [],
    attachmentNotices: event.attachmentNotices ?? [],
    devLoopContextJson: event.devLoopContext
      ? JSON.stringify(event.devLoopContext)
      : undefined,
    correlationTag: event.correlationTag,
    quotedContextJson: event.quotedContext
      ? JSON.stringify(event.quotedContext)
      : undefined,
    ttl: BUFFERED_NEW_MESSAGE_TTL_SECONDS,
  });

  const container = getContainer(SESSIONS_CONTAINER);
  await container.items.upsert(doc);
  trackEvent({
    name: 'BufferedIngressQueued',
    correlationId,
    userId,
    properties: {
      instanceId: targetInstanceId ?? 'unknown',
      source: event.devLoopContext?.isDevLoop ? 'devloop-relay' : 'unknown',
    },
  });
}

export async function dequeueBufferedNewMessageForUser(
  userId: string,
): Promise<NewMessageEvent | null> {
  const container = getContainer(SESSIONS_CONTAINER);
  const { resources } = await container.items
    .query<BufferedNewMessageDocument>({
      query: `SELECT TOP 1 * FROM c WHERE c.type = @type AND c.userId = @userId AND (NOT IS_DEFINED(c.status) OR c.status = @status) ORDER BY c.queuedAt ASC`,
      parameters: [
        { name: '@type', value: BUFFERED_NEW_MESSAGE_TYPE },
        { name: '@userId', value: userId },
        { name: '@status', value: 'queued' },
      ],
    })
    .fetchAll();

  const doc = resources[0];
  if (!doc) {
    return null;
  }

  const dequeuedAt = new Date().toISOString();
  await container.item(doc.id, userId).replace({
    ...doc,
    status: 'dequeued',
    dequeuedAt,
  });

  trackEvent({
    name: 'BufferedIngressDequeued',
    correlationId: doc.correlationId,
    userId: doc.userId,
    properties: {
      instanceId: doc.targetInstanceId ?? 'unknown',
      source: doc.devLoopContextJson ? 'devloop-relay' : 'unknown',
    },
  });

  return toNewMessageEvent(doc);
}

export async function listStaleQueuedBufferedMessages(
  olderThanIso: string,
  limit = 20,
): Promise<BufferedQueuedReplayCandidate[]> {
  const container = getContainer(SESSIONS_CONTAINER);
  const { resources } = await container.items
    .query<BufferedNewMessageDocument>({
      query: `SELECT TOP @limit * FROM c WHERE c.type = @type AND (NOT IS_DEFINED(c.status) OR c.status = @status) AND c.queuedAt <= @olderThan ORDER BY c.queuedAt ASC`,
      parameters: [
        { name: '@limit', value: limit },
        { name: '@type', value: BUFFERED_NEW_MESSAGE_TYPE },
        { name: '@status', value: 'queued' },
        { name: '@olderThan', value: olderThanIso },
      ],
    })
    .fetchAll();

  return resources.map((doc) => ({
    docId: doc.id,
    userId: doc.userId,
    correlationId: doc.correlationId,
    event: toNewMessageEvent(doc),
  } satisfies BufferedQueuedReplayCandidate));
}

export async function listBufferedIngressDocumentsForUser(
  userId: string,
  status?: BufferedIngressStatus,
  limit = 20,
): Promise<BufferedIngressDocumentSummary[]> {
  const container = getContainer(SESSIONS_CONTAINER);
  const query = status
    ? {
        query: `SELECT TOP @limit * FROM c WHERE c.type = @type AND c.userId = @userId AND c.status = @status ORDER BY c.queuedAt DESC`,
        parameters: [
          { name: '@limit', value: limit },
          { name: '@type', value: BUFFERED_NEW_MESSAGE_TYPE },
          { name: '@userId', value: userId },
          { name: '@status', value: status },
        ],
      }
    : {
        query: `SELECT TOP @limit * FROM c WHERE c.type = @type AND c.userId = @userId ORDER BY c.queuedAt DESC`,
        parameters: [
          { name: '@limit', value: limit },
          { name: '@type', value: BUFFERED_NEW_MESSAGE_TYPE },
          { name: '@userId', value: userId },
        ],
      };

  const { resources } = await container.items.query<BufferedNewMessageDocument>(query).fetchAll();
  return resources.map((doc) => toBufferedIngressDocumentSummary(doc));
}

export async function getQueuedBufferedReplayCandidateByCorrelation(
  userId: string,
  correlationId: string,
): Promise<BufferedQueuedReplayCandidate | undefined> {
  const container = getContainer(SESSIONS_CONTAINER);
  const { resources } = await container.items
    .query<BufferedNewMessageDocument>({
      query: `SELECT TOP 1 * FROM c WHERE c.type = @type AND c.userId = @userId AND c.correlationId = @correlationId AND c.status = @status`,
      parameters: [
        { name: '@type', value: BUFFERED_NEW_MESSAGE_TYPE },
        { name: '@userId', value: userId },
        { name: '@correlationId', value: correlationId },
        { name: '@status', value: 'queued' },
      ],
    })
    .fetchAll();

  const doc = resources[0];
  if (!doc) {
    return undefined;
  }

  return {
    docId: doc.id,
    userId: doc.userId,
    correlationId: doc.correlationId,
    event: toNewMessageEvent(doc),
  } satisfies BufferedQueuedReplayCandidate;
}

export async function markBufferedNewMessageReplayed(
  docId: string,
  userId: string,
  replayedInstanceId: string,
): Promise<void> {
  const container = getContainer(SESSIONS_CONTAINER);
  const { resource } = await container.item(docId, userId).read<BufferedNewMessageDocument>();
  if (!resource) {
    return;
  }

  await container.item(docId, userId).replace({
    ...resource,
    status: 'replayed',
    replayedAt: new Date().toISOString(),
    replayedInstanceId,
  });
}

export async function handleBufferedIngressActivity(
  rawInput: unknown,
): Promise<NewMessageEvent | null> {
  const input = BufferedIngressActivityInputSchema.parse(rawInput);

  switch (input.action) {
    case 'dequeue-new-message':
      return dequeueBufferedNewMessageForUser(input.userId);
  }
}

df.app.activity('bufferedIngressActivity', {
  handler: async (rawInput: unknown): Promise<NewMessageEvent | null> => {
    return handleBufferedIngressActivity(rawInput);
  },
});