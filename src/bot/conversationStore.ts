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
