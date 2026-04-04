import * as df from 'durable-functions';
import { z } from 'zod';
import { getContainer } from '../memory/cosmosClient.js';
import type { NewMessageEvent } from './overseer.js';
import { RuntimeAssetReferenceSchema } from '../integrations/runtimeAssetStore.js';

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
  userId: z.string().min(1),
  userAlias: z.string().min(1),
  correlationId: z.string().min(1),
  userMessage: z.string().min(1),
  queuedAt: z.string().min(1),
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

export async function queueBufferedNewMessage(
  event: NewMessageEvent,
  userId: string,
  targetInstanceId?: string,
): Promise<void> {
  const correlationId = event.correlationId ?? crypto.randomUUID();
  const doc = BufferedNewMessageDocumentSchema.parse({
    id: `buffered-new-message-${correlationId}`,
    type: BUFFERED_NEW_MESSAGE_TYPE,
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
}

export async function dequeueBufferedNewMessageForUser(
  userId: string,
): Promise<NewMessageEvent | null> {
  const container = getContainer(SESSIONS_CONTAINER);
  const { resources } = await container.items
    .query<BufferedNewMessageDocument>({
      query: `SELECT TOP 1 * FROM c WHERE c.type = @type AND c.userId = @userId ORDER BY c.queuedAt ASC`,
      parameters: [
        { name: '@type', value: BUFFERED_NEW_MESSAGE_TYPE },
        { name: '@userId', value: userId },
      ],
    })
    .fetchAll();

  const doc = resources[0];
  if (!doc) {
    return null;
  }

  await container.item(doc.id, userId).delete();

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