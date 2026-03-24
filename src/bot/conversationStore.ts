// Conversation reference store — persists Teams ConversationReference to Cosmos DB.
// Enables proactive reply after container restart.
// Spec ref: 10-Teams-Interface.md, 07-Memory-Manager.md, issue #22

import type { ConversationReference } from 'botbuilder';
import { getContainer } from '../memory/cosmosClient.js';

const CONTAINER_NAME = 'conversationReferences';

interface ConvRefDocument {
  /** Document id — 'convref-{userId}' */
  id: string;
  /** Partition key — Teams conversation id from the ConversationReference */
  conversationId: string;
  userId: string;
  conversationReference: Partial<ConversationReference>;
  updatedAt: string;
}

interface PendingAckDocument {
  /** Document id — 'ack-{userId}' */
  id: string;
  /** Partition key — same as convref for co-location */
  conversationId: string;
  userId: string;
  activityId: string;
  createdAt: string;
}

/** Upsert the ConversationReference for a user. Called on every inbound message. */
export async function saveConversationReference(
  userId: string,
  conversationReference: Partial<ConversationReference>,
): Promise<void> {
  const conversationId = conversationReference.conversation?.id ?? userId;
  const doc: ConvRefDocument = {
    id: `convref-${userId}`,
    conversationId,
    userId,
    conversationReference,
    updatedAt: new Date().toISOString(),
  };
  const container = getContainer(CONTAINER_NAME);
  await container.items.upsert(doc);
}

/**
 * Retrieve the ConversationReference for a user.
 * Returns null if not found (first-ever message hasn't been saved yet).
 */
export async function getConversationReference(
  userId: string,
): Promise<Partial<ConversationReference> | null> {
  const container = getContainer(CONTAINER_NAME);

  // Cross-partition query by id (id is unique across all partitions)
  const { resources } = await container.items
    .query<ConvRefDocument>({
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: `convref-${userId}` }],
    })
    .fetchAll();

  return resources[0]?.conversationReference ?? null;
}

/**
 * Store the activityId of the "⌛ Working on it..." ack message so it can be
 * replaced in-place by sendReplyActivity (spec: 10-Teams-Interface.md §Message Flow).
 */
export async function savePendingAckId(
  userId: string,
  conversationId: string,
  activityId: string,
): Promise<void> {
  const doc: PendingAckDocument = {
    id: `ack-${userId}`,
    conversationId,
    userId,
    activityId,
    createdAt: new Date().toISOString(),
  };
  const container = getContainer(CONTAINER_NAME);
  await container.items.upsert(doc);
}

/** Retrieve the pending ack activityId. Returns null if none stored. */
export async function getPendingAckId(userId: string): Promise<string | null> {
  const container = getContainer(CONTAINER_NAME);
  const { resources } = await container.items
    .query<PendingAckDocument>({
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: `ack-${userId}` }],
    })
    .fetchAll();
  return resources[0]?.activityId ?? null;
}

/** Delete the pending ack record after the reply has been sent. */
export async function clearPendingAckId(
  userId: string,
  conversationId: string,
): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  try {
    await container.item(`ack-${userId}`, conversationId).delete();
  } catch {
    // Already gone — safe to ignore
  }
}

/**
 * Get all pending ack documents older than maxAgeMs.
 * Used by startup recovery to detect dangling acks from crashed sessions (#191).
 */
export async function getStaleAcks(maxAgeMs: number): Promise<PendingAckDocument[]> {
  const container = getContainer(CONTAINER_NAME);
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const { resources } = await container.items
    .query<PendingAckDocument>({
      query: `SELECT * FROM c WHERE STARTSWITH(c.id, 'ack-') AND c.createdAt < @cutoff`,
      parameters: [{ name: '@cutoff', value: cutoff }],
    })
    .fetchAll();
  return resources;
}
