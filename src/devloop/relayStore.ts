// DevLoop Relay — Cosmos-backed bidirectional message channel between DevLoop (IDE) and Runtime.
// Container: ide-messages (Bicep-provisioned, partition key: /correlationTag, 7d TTL)
// Spec ref: ADDENDA-08 §3, 0g-Bidirectional-Communication-Evolution.md

import { z } from 'zod';
import { getContainer } from '../memory/cosmosClient.js';
import { DEVLOOP_PROTOCOL_VERSION } from './radioProtocol.js';

const IDE_MESSAGES_CONTAINER = 'ide-messages';
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const IdeMessageDocumentSchema = z.object({
  id: z.string(),
  correlationTag: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  sender: z.enum(['devloop', 'runtime']),
  messageType: z.enum(['DEVQUERY', 'DEVLOOP', 'HELKIN-REPLY', 'ASYNC-NOTIFICATION', 'HEARTBEAT', 'SWARM-TOOL-REPORT']),
  payload: z.record(z.unknown()),
  timestamp: z.string(),
  expiresAt: z.string(),
  status: z.enum(['pending', 'delivered', 'failed']),
  deliveredAt: z.string().optional(),
  deliveryAttempts: z.number().default(0),
  protocolVersion: z.string().default(DEVLOOP_PROTOCOL_VERSION),
  ttl: z.number().default(TTL_SECONDS),
});

export type IdeMessageDocument = z.infer<typeof IdeMessageDocumentSchema>;

// ---------------------------------------------------------------------------
// Write — persist a relay message
// ---------------------------------------------------------------------------

export interface RelayMessageInput {
  correlationTag: string;
  direction: 'inbound' | 'outbound';
  sender: 'devloop' | 'runtime';
  messageType: IdeMessageDocument['messageType'];
  payload: Record<string, unknown>;
}

export async function writeRelayMessage(input: RelayMessageInput): Promise<IdeMessageDocument> {
  const container = getContainer(IDE_MESSAGES_CONTAINER);
  const now = new Date();

  const doc: IdeMessageDocument = {
    id: crypto.randomUUID(),
    correlationTag: input.correlationTag,
    direction: input.direction,
    sender: input.sender,
    messageType: input.messageType,
    payload: input.payload,
    timestamp: now.toISOString(),
    expiresAt: new Date(now.getTime() + TTL_SECONDS * 1000).toISOString(),
    status: 'pending',
    deliveryAttempts: 0,
    protocolVersion: DEVLOOP_PROTOCOL_VERSION,
    ttl: TTL_SECONDS,
  };

  IdeMessageDocumentSchema.parse(doc);
  await container.items.create(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Read — poll for outbound messages (Runtime → DevLoop)
// ---------------------------------------------------------------------------

export async function pollOutboundMessages(
  since: string,
  limit: number = 50,
): Promise<IdeMessageDocument[]> {
  const container = getContainer(IDE_MESSAGES_CONTAINER);
  const { resources } = await container.items
    .query<IdeMessageDocument>({
      query: `SELECT * FROM c WHERE c.direction = 'outbound' AND c.status = 'pending' AND c.timestamp > @since ORDER BY c.timestamp ASC OFFSET 0 LIMIT @limit`,
      parameters: [
        { name: '@since', value: since },
        { name: '@limit', value: limit },
      ],
    })
    .fetchAll();

  return resources;
}

// ---------------------------------------------------------------------------
// Acknowledge — mark messages as delivered
// ---------------------------------------------------------------------------

export async function markDelivered(messageId: string, correlationTag: string): Promise<void> {
  const container = getContainer(IDE_MESSAGES_CONTAINER);
  await container.item(messageId, correlationTag).patch({
    operations: [
      { op: 'replace', path: '/status', value: 'delivered' },
      { op: 'replace', path: '/deliveredAt', value: new Date().toISOString() },
    ],
  });
}

// ---------------------------------------------------------------------------
// Read — get all messages for a correlation tag (both directions)
// ---------------------------------------------------------------------------

export async function getMessagesByCorrelation(correlationTag: string): Promise<IdeMessageDocument[]> {
  const container = getContainer(IDE_MESSAGES_CONTAINER);
  const { resources } = await container.items
    .query<IdeMessageDocument>({
      query: 'SELECT * FROM c WHERE c.correlationTag = @tag ORDER BY c.timestamp ASC',
      parameters: [{ name: '@tag', value: correlationTag }],
    })
    .fetchAll();

  return resources;
}
