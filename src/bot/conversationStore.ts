// Conversation reference store — persists Teams ConversationReference to Cosmos DB.
// Enables proactive reply after container restart.
// Spec ref: 10-Teams-Interface.md, 07-Memory-Manager.md, issue #22

import type { ConversationReference } from 'botbuilder';
import { getContainer } from '../memory/cosmosClient.js';

const CONTAINER_NAME = 'conversationReferences';
const SENT_MESSAGE_TTL_SECONDS = 7 * 24 * 60 * 60;

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
  /** Document id — 'ack-{correlationId}' */
  id: string;
  /** Partition key — same as convref for co-location */
  conversationId: string;
  userId: string;
  correlationId: string;
  activityId: string;
  createdAt: string;
}

interface SentMessageDocument {
  /** Document id — 'sentmsg-{activityId}' */
  id: string;
  /** Partition key — Teams conversation id */
  conversationId: string;
  userId: string;
  activityId: string;
  text: string;
  createdAt: string;
  ttl: number;
}

export interface PendingAckSnapshot {
  pendingAcks: number;
  oldestPendingAgeMs: number | null;
  stalePendingAcks: number;
  oldestStalePendingAgeMs: number | null;
}

export type OutboundArtifactKind = 'reply' | 'confirmation-card' | 'email-send' | 'session-execution';

interface OutboundArtifactDocument {
  /** Document id — 'outbound-{kind}-{dedupKey}' */
  id: string;
  /** Partition key — same conversation id as related conversation reference */
  conversationId: string;
  userId: string;
  kind: OutboundArtifactKind;
  dedupKey: string;
  createdAt: string;
}

export function makePendingAckDocumentId(correlationId: string): string {
  return `ack-${correlationId}`;
}

export function makeOutboundArtifactDocumentId(
  kind: OutboundArtifactKind,
  dedupKey: string,
): string {
  return `outbound-${kind}-${dedupKey}`;
}

export function makeSentMessageDocumentId(activityId: string): string {
  return `sentmsg-${activityId}`;
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

/** Persist a bot-sent message so quoted replies can recover full text after restarts/deploys. */
export async function saveSentMessageText(
  userId: string,
  conversationId: string,
  activityId: string,
  text: string,
  createdAt = new Date().toISOString(),
): Promise<void> {
  if (!activityId || !text) {
    return;
  }

  const doc: SentMessageDocument = {
    id: makeSentMessageDocumentId(activityId),
    conversationId,
    userId,
    activityId,
    text,
    createdAt,
    ttl: SENT_MESSAGE_TTL_SECONDS,
  };

  const container = getContainer(CONTAINER_NAME);
  await container.items.upsert(doc);
}

/** Retrieve a persisted bot-sent message by activity id. */
export async function getStoredSentMessage(
  activityId: string,
  conversationId?: string,
): Promise<string | null> {
  const container = getContainer(CONTAINER_NAME);
  const documentId = makeSentMessageDocumentId(activityId);

  if (conversationId) {
    try {
      const { resource } = await container.item(documentId, conversationId).read<SentMessageDocument>();
      return resource?.text ?? null;
    } catch {
      return null;
    }
  }

  const { resources } = await container.items
    .query<SentMessageDocument>({
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: documentId }],
    })
    .fetchAll();

  return resources[0]?.text ?? null;
}

/**
 * Store the activityId of the "⌛ Working on it..." ack message so it can be
 * replaced in-place by sendReplyActivity (spec: 10-Teams-Interface.md §Message Flow).
 */
export async function savePendingAckId(
  userId: string,
  conversationId: string,
  activityId: string,
  correlationId: string,
  createdAt = new Date().toISOString(),
): Promise<void> {
  const doc: PendingAckDocument = {
    id: makePendingAckDocumentId(correlationId),
    conversationId,
    userId,
    correlationId,
    activityId,
    createdAt,
  };
  const container = getContainer(CONTAINER_NAME);
  await container.items.upsert(doc);
}

/** Retrieve the pending ack activityId. Returns null if none stored. */
export async function getPendingAckId(correlationId: string): Promise<string | null> {
  const container = getContainer(CONTAINER_NAME);
  const { resources } = await container.items
    .query<PendingAckDocument>({
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: makePendingAckDocumentId(correlationId) }],
    })
    .fetchAll();
  return resources[0]?.activityId ?? null;
}

/** Delete the pending ack record after the reply has been sent. */
export async function clearPendingAckId(
  conversationId: string,
  correlationId: string,
): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  try {
    await container.item(makePendingAckDocumentId(correlationId), conversationId).delete();
  } catch {
    // Already gone — safe to ignore
  }
}

/**
 * Claim a user-visible outbound side effect (reply, confirmation card) so
 * Durable retries/replays do not emit duplicates.
 * Returns true when the caller owns the claim, false when a prior attempt already claimed it.
 */
export async function claimOutboundArtifact(
  conversationId: string,
  userId: string,
  kind: OutboundArtifactKind,
  dedupKey: string,
): Promise<boolean> {
  const container = getContainer(CONTAINER_NAME);
  const doc: OutboundArtifactDocument = {
    id: makeOutboundArtifactDocumentId(kind, dedupKey),
    conversationId,
    userId,
    kind,
    dedupKey,
    createdAt: new Date().toISOString(),
  };

  try {
    await container.items.create(doc);
    return true;
  } catch (err) {
    const statusCode = typeof err === 'object' && err !== null && 'code' in err
      ? Number((err as { code?: unknown }).code)
      : typeof err === 'object' && err !== null && 'statusCode' in err
        ? Number((err as { statusCode?: unknown }).statusCode)
        : undefined;
    if (statusCode === 409) {
      return false;
    }
    throw err;
  }
}

/**
 * Release an outbound-artifact claim when the send failed before anything was delivered.
 */
export async function releaseOutboundArtifactClaim(
  conversationId: string,
  kind: OutboundArtifactKind,
  dedupKey: string,
): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  try {
    await container.item(makeOutboundArtifactDocumentId(kind, dedupKey), conversationId).delete();
  } catch {
    // Already gone — safe to ignore
  }
}

/**
 * Check whether an outbound-artifact claim already exists.
 * Used to suppress duplicate same-correlation session re-entry after a visible reply.
 */
export async function hasOutboundArtifactClaim(
  conversationId: string,
  kind: OutboundArtifactKind,
  dedupKey: string,
): Promise<boolean> {
  const container = getContainer(CONTAINER_NAME);
  try {
    const { resource } = await container
      .item(makeOutboundArtifactDocumentId(kind, dedupKey), conversationId)
      .read<OutboundArtifactDocument>();
    return resource !== undefined;
  } catch {
    return false;
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

export async function getPendingAckSnapshot(maxAgeMs: number): Promise<PendingAckSnapshot> {
  const container = getContainer(CONTAINER_NAME);
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const { resources } = await container.items
    .query<PendingAckDocument>({
      query: `SELECT * FROM c WHERE STARTSWITH(c.id, 'ack-')`,
    })
    .fetchAll();

  const now = Date.now();
  const ages = resources
    .map((doc) => {
      const createdAtMs = Date.parse(doc.createdAt);
      return Number.isNaN(createdAtMs) ? null : now - createdAtMs;
    })
    .filter((age): age is number => age !== null)
    .sort((a, b) => b - a);

  const staleAges = resources
    .filter((doc) => doc.createdAt < cutoff)
    .map((doc) => {
      const createdAtMs = Date.parse(doc.createdAt);
      return Number.isNaN(createdAtMs) ? null : now - createdAtMs;
    })
    .filter((age): age is number => age !== null)
    .sort((a, b) => b - a);

  return {
    pendingAcks: resources.length,
    oldestPendingAgeMs: ages[0] ?? null,
    stalePendingAcks: staleAges.length,
    oldestStalePendingAgeMs: staleAges[0] ?? null,
  };
}
