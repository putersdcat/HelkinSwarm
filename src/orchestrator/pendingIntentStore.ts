// Pending Intent Store — Cosmos-backed queue for offline/failed message recovery.
// Persists user intents that could not be routed to the overseer, enabling
// startup recovery to replay them after the service comes back online.
// Spec ref: ADDENDA-06, Issue #116

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getContainer } from '../memory/cosmosClient.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const CONTAINER_NAME = 'pendingIntents';

export const PendingIntentStatusSchema = z.enum([
  'received',
  'processing',
  'processed',
  'failed',
  'expired',
]);
export type PendingIntentStatus = z.infer<typeof PendingIntentStatusSchema>;

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const PendingIntentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  correlationId: z.string().optional(),
  idempotencyKey: z.string(),
  status: PendingIntentStatusSchema,
  timestamp: z.string(),
  messageText: z.string(),
  attachments: z.array(z.string()).default([]),
  classifiedIntent: z.string().optional(),
  riskLevel: RiskLevelSchema.default('low'),
  requiresConfirmation: z.boolean().default(false),
  externalEffects: z.array(z.string()).default([]),
  trackingId: z.string(),
  /** Error detail if status is 'failed' */
  failureReason: z.string().optional(),
  /** When the intent was processed */
  processedAt: z.string().optional(),
  /** Conversation reference for proactive reply */
  conversationReferenceJson: z.string().optional(),
  /** Model override: 'primary', 'secondary', or direct deployment name (#217) */
  modelOverride: z.string().optional(),
  /** DevLoop context if protocol message */
  devLoopContextJson: z.string().optional(),
  /** Image URLs from attachments */
  imageUrls: z.array(z.string()).default([]),
  /** TTL in seconds — 7 days */
  ttl: z.number().default(604800),
});

export type PendingIntent = z.infer<typeof PendingIntentSchema>;

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/** Create a pending intent from a failed/offline turn. Returns the tracking ID. */
export async function createPendingIntent(input: {
  userId: string;
  messageText: string;
  conversationReferenceJson?: string;
  modelOverride?: string;
  devLoopContextJson?: string;
  imageUrls?: string[];
  correlationId?: string;
  creationReason?: string;
  userNotified?: boolean;
}): Promise<{ trackingId: string; id: string; intent: PendingIntent }> {
  const container = getContainer(CONTAINER_NAME);
  const id = randomUUID();
  const trackingId = `PI-${Date.now().toString(36).toUpperCase()}`;
  const idempotencyKey = `${input.userId}:${Date.now()}:${input.messageText.slice(0, 50)}`;

  const doc: PendingIntent = {
    id,
    userId: input.userId,
    correlationId: input.correlationId ?? id,
    idempotencyKey,
    status: 'received',
    timestamp: new Date().toISOString(),
    messageText: input.messageText,
    attachments: [],
    riskLevel: 'low',
    requiresConfirmation: false,
    externalEffects: [],
    trackingId,
    conversationReferenceJson: input.conversationReferenceJson,
    modelOverride: input.modelOverride,
    devLoopContextJson: input.devLoopContextJson,
    imageUrls: input.imageUrls ?? [],
    ttl: 604800, // 7 days
  };

  await container.items.create(doc);

  trackEvent({
    name: 'PendingIntentCreated',
    correlationId: doc.correlationId ?? id,
    userId: input.userId,
    properties: {
      trackingId,
      textLength: String(input.messageText.length),
      creationReason: input.creationReason ?? 'overseer-unreachable',
      userNotified: input.userNotified ?? false,
    },
  });

  return { trackingId, id, intent: doc };
}

/** Get all unprocessed intents for recovery, ordered by timestamp. */
export async function getUnprocessedIntents(limit = 50): Promise<PendingIntent[]> {
  const container = getContainer(CONTAINER_NAME);
  const query = {
    query: `SELECT * FROM c WHERE c.status IN ('received', 'failed') ORDER BY c.timestamp ASC OFFSET 0 LIMIT @limit`,
    parameters: [{ name: '@limit', value: limit }],
  };
  const { resources } = await container.items.query<PendingIntent>(query).fetchAll();
  return resources;
}

/** Get unprocessed intents for a specific user. */
export async function getUnprocessedIntentsForUser(userId: string): Promise<PendingIntent[]> {
  const container = getContainer(CONTAINER_NAME);
  const query = {
    query: `SELECT * FROM c WHERE c.userId = @userId AND c.status IN ('received', 'failed') ORDER BY c.timestamp ASC`,
    parameters: [{ name: '@userId', value: userId }],
  };
  const { resources } = await container.items.query<PendingIntent>(query).fetchAll();
  return resources;
}

/** Mark an intent as processing (to prevent double-processing). */
export async function markIntentProcessing(id: string, userId: string): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  await container.item(id, userId).patch([
    { op: 'replace', path: '/status', value: 'processing' },
  ]);
}

/** Reset an intent back to received so a later replay pass can retry it. */
export async function markIntentReceived(
  id: string,
  userId: string,
  failureReason?: string,
): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  const { resource } = await container.item(id, userId).read<PendingIntent>();
  if (!resource) {
    return;
  }

  const nextDoc: PendingIntent = {
    ...resource,
    status: 'received',
    ...(failureReason ? { failureReason } : {}),
  };

  if (!failureReason) {
    delete nextDoc.failureReason;
  }

  await container.item(id, userId).replace(nextDoc);
}

/** Mark an intent as successfully processed. */
export async function markIntentProcessed(id: string, userId: string): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  await container.item(id, userId).patch([
    { op: 'replace', path: '/status', value: 'processed' },
    { op: 'add', path: '/processedAt', value: new Date().toISOString() },
  ]);
}

/** Mark an intent as failed with a reason. */
export async function markIntentFailed(id: string, userId: string, reason: string): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  await container.item(id, userId).patch([
    { op: 'replace', path: '/status', value: 'failed' },
    { op: 'add', path: '/failureReason', value: reason },
  ]);
}

/** Check if an idempotency key already exists (dedup). */
export async function hasIdempotencyKey(key: string): Promise<boolean> {
  const container = getContainer(CONTAINER_NAME);
  const query = {
    query: 'SELECT c.id FROM c WHERE c.idempotencyKey = @key AND c.status = "processed"',
    parameters: [{ name: '@key', value: key }],
  };
  const { resources } = await container.items.query(query).fetchAll();
  return resources.length > 0;
}
