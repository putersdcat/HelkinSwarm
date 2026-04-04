import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import * as df from 'durable-functions';
import { resolveDeliverableOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';
import {
  listStaleQueuedBufferedMessages,
  markBufferedNewMessageReplayed,
} from '../orchestrator/bufferedIngressActivity.js';
import { signalMindSessionAcquire } from '../orchestrator/mindSessionGuard.js';
import { getActiveTurnCountForUser } from '../observability/orchestratorStageHealth.js';
import { trackEvent } from '../observability/telemetry.js';

const BUFFERED_INGRESS_REPLAY_STALE_MS = parseInt(process.env['BUFFERED_INGRESS_REPLAY_STALE_MS'] ?? '', 10) || 90_000;

app.timer('bufferedIngressReplayTimer', {
  schedule: '0 * * * * *',
  extraInputs: [df.input.durableClient()],
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const client = df.getClient(context);
    const cutoffIso = new Date(Date.now() - BUFFERED_INGRESS_REPLAY_STALE_MS).toISOString();
    const queuedFollowers = await listStaleQueuedBufferedMessages(cutoffIso);

    if (queuedFollowers.length === 0) {
      return;
    }

    context.log(`[bufferedIngressReplay] Found ${queuedFollowers.length} stale queued follower(s)`);

    for (const queuedFollower of queuedFollowers) {
      const [deliverableOverseerInstanceId, activeTurnCount] = await Promise.all([
        resolveDeliverableOverseerInstanceId(client, queuedFollower.userId),
        getActiveTurnCountForUser(queuedFollower.userId),
      ]);

      if (deliverableOverseerInstanceId || activeTurnCount > 0) {
        continue;
      }

      const replayInstanceId = `overseer-${queuedFollower.userId}-buffered-${crypto.randomUUID().slice(0, 8)}`;

      await client.startNew('overseer', { instanceId: replayInstanceId, input: queuedFollower.event });
      await signalMindSessionAcquire(client, queuedFollower.userId, {
        instanceId: replayInstanceId,
        correlationId: queuedFollower.correlationId,
        source: 'buffered-ingress-replay',
      });
      await markBufferedNewMessageReplayed(queuedFollower.docId, queuedFollower.userId, replayInstanceId);

      trackEvent({
        name: 'BufferedIngressFallbackReplayed',
        correlationId: queuedFollower.correlationId,
        userId: queuedFollower.userId,
        properties: {
          instanceId: replayInstanceId,
          source: 'buffered-ingress-replay',
        },
      });
    }
  },
});