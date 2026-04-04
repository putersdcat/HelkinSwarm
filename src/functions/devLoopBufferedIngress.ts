import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { z } from 'zod';
import { isOwnerUserId } from '../bot/maintenanceMode.js';
import { resolveDeliverableOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';
import {
  getQueuedBufferedReplayCandidateByCorrelation,
  listBufferedIngressDocumentsForUser,
  markBufferedNewMessageReplayed,
  type BufferedIngressStatus,
} from '../orchestrator/bufferedIngressActivity.js';
import { signalMindSessionAcquire } from '../orchestrator/mindSessionGuard.js';
import { getActiveTurnCountForUser } from '../observability/orchestratorStageHealth.js';
import { trackEvent } from '../observability/telemetry.js';

const ManualReplayPayloadSchema = z.object({
  correlationId: z.string().min(1),
});

function parseStatus(value: string | null): BufferedIngressStatus | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'queued' || value === 'dequeued' || value === 'replayed') {
    return value;
  }

  return undefined;
}

app.http('devloopBufferedIngressList', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'devloop/buffered-ingress',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const status = parseStatus(req.query.get('status'));
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.get('limit') ?? '20', 10) || 20));
    const docs = await listBufferedIngressDocumentsForUser(userId, status, limit);

    return {
      status: 200,
      jsonBody: {
        userId,
        count: docs.length,
        docs,
      },
    };
  },
});

app.http('devloopBufferedIngressReplay', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'devloop/buffered-ingress/replay',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    let body: z.infer<typeof ManualReplayPayloadSchema>;
    try {
      body = ManualReplayPayloadSchema.parse(await req.json());
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid payload. Required: correlationId.' } };
    }

    const queuedFollower = await getQueuedBufferedReplayCandidateByCorrelation(userId, body.correlationId);
    if (!queuedFollower) {
      return { status: 404, jsonBody: { error: 'No queued buffered follower found for that correlationId.' } };
    }

    const client = df.getClient(context);
    const [deliverableOverseerInstanceId, activeTurnCount] = await Promise.all([
      resolveDeliverableOverseerInstanceId(client, userId),
      getActiveTurnCountForUser(userId),
    ]);

    if (activeTurnCount > 0) {
      return {
        status: 409,
        jsonBody: {
          error: 'A living session is still actively processing; manual replay is blocked until active turns drain.',
          deliverableOverseerInstanceId,
          activeTurnCount,
        },
      };
    }

    let replayInstanceId: string;
    let replayMode: 'raise-event' | 'start-new';

    if (deliverableOverseerInstanceId) {
      await client.raiseEvent(deliverableOverseerInstanceId, 'NewMessage', queuedFollower.event);
      replayInstanceId = deliverableOverseerInstanceId;
      replayMode = 'raise-event';
    } else {
      replayInstanceId = `overseer-${userId}-manual-buffered-${crypto.randomUUID().slice(0, 8)}`;
      await client.startNew('overseer', { instanceId: replayInstanceId, input: queuedFollower.event });
      await signalMindSessionAcquire(client, userId, {
        instanceId: replayInstanceId,
        correlationId: queuedFollower.correlationId,
        source: 'buffered-ingress-manual-replay',
      });
      replayMode = 'start-new';
    }

    await markBufferedNewMessageReplayed(queuedFollower.docId, userId, replayInstanceId);

    trackEvent({
      name: 'BufferedIngressFallbackReplayed',
      correlationId: queuedFollower.correlationId,
      userId,
      properties: {
        instanceId: replayInstanceId,
        source: 'buffered-ingress-manual-replay',
      },
    });

    return {
      status: 200,
      jsonBody: {
        correlationId: queuedFollower.correlationId,
        replayed: true,
        replayInstanceId,
        replayMode,
      },
    };
  },
});