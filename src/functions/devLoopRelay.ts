// DevLoop Relay HTTP endpoints — push (DevLoop→Runtime) and pull (Runtime→DevLoop).
// Spec ref: ADDENDA-08 §3.3-3.4, 0g-Bidirectional-Communication-Evolution.md

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { z } from 'zod';
import { isOwnerUserId } from '../bot/maintenanceMode.js';
import {
  writeRelayMessage,
  pollOutboundMessages,
  markDelivered,
  getMessagesByCorrelation,
} from '../devloop/relayStore.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const PushPayloadSchema = z.object({
  correlationTag: z.string(),
  messageType: z.enum(['DEVQUERY', 'DEVLOOP', 'HEARTBEAT']),
  payload: z.record(z.unknown()).default({}),
});

const AckPayloadSchema = z.object({
  messageIds: z.array(z.object({
    id: z.string(),
    correlationTag: z.string(),
  })),
});

// ---------------------------------------------------------------------------
// POST /api/devloop/push — DevLoop sends a message to the runtime
// ---------------------------------------------------------------------------

app.http('devloopPush', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/push',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: z.infer<typeof PushPayloadSchema>;
    try {
      body = PushPayloadSchema.parse(await req.json());
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid payload. Required: correlationTag, messageType.' } };
    }

    const doc = await writeRelayMessage({
      correlationTag: body.correlationTag,
      direction: 'inbound',
      sender: 'devloop',
      messageType: body.messageType,
      payload: body.payload,
    });

    // Raise durable event to wake the overseer if it's listening for DevLoop messages
    const client = df.getClient(context);
    try {
      await client.raiseEvent(userId, 'DevLoopMessage', {
        messageId: doc.id,
        correlationTag: doc.correlationTag,
        messageType: doc.messageType,
      });
    } catch {
      // Overseer may not be running — message is persisted in Cosmos regardless
    }

    context.log(`[devloopRelay] Push: type=${doc.messageType} corr=${doc.correlationTag}`);
    trackEvent({
      name: 'DevLoopRelayPush',
      correlationId: doc.correlationTag,
      userId,
      properties: { messageType: doc.messageType, messageId: doc.id },
    });
    return {
      status: 202,
      jsonBody: { messageId: doc.id, correlationTag: doc.correlationTag },
    };
  },
});

// ---------------------------------------------------------------------------
// GET /api/devloop/poll — DevLoop polls for outbound messages from runtime
// ---------------------------------------------------------------------------

app.http('devloopPoll', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'devloop/poll',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const since = req.query.get('since') ?? new Date(Date.now() - 60 * 1000).toISOString();
    const limit = Math.min(parseInt(req.query.get('limit') ?? '50', 10), 100);

    const messages = await pollOutboundMessages(since, limit);
    if (messages.length > 0) {
      trackEvent({
        name: 'DevLoopRelayPoll',
        correlationId: messages[0].correlationTag,
        userId,
        properties: { count: messages.length },
      });
    }
    return {
      status: 200,
      jsonBody: { messages, count: messages.length },
    };
  },
});

// ---------------------------------------------------------------------------
// POST /api/devloop/ack — DevLoop acknowledges message delivery
// ---------------------------------------------------------------------------

app.http('devloopAck', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/ack',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: z.infer<typeof AckPayloadSchema>;
    try {
      body = AckPayloadSchema.parse(await req.json());
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid payload. Required: messageIds[{id, correlationTag}].' } };
    }

    let acknowledged = 0;
    for (const msg of body.messageIds) {
      try {
        await markDelivered(msg.id, msg.correlationTag);
        acknowledged++;
      } catch {
        // Message may have been deleted or already delivered
      }
    }

    return { status: 200, jsonBody: { acknowledged } };
  },
});

// ---------------------------------------------------------------------------
// GET /api/devloop/thread/{correlationTag} — Get all messages for a correlation
// ---------------------------------------------------------------------------

app.http('devloopThread', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'devloop/thread/{correlationTag}',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const correlationTag = req.params.correlationTag;
    if (!correlationTag) {
      return { status: 400, jsonBody: { error: 'Missing correlationTag parameter.' } };
    }

    const messages = await getMessagesByCorrelation(correlationTag);
    return {
      status: 200,
      jsonBody: { correlationTag, messages, count: messages.length },
    };
  },
});
