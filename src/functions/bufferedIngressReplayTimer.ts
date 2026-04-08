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
import { getActiveTurnStagesForUser } from '../observability/orchestratorStageHealth.js';
import { trackEvent } from '../observability/telemetry.js';

const BUFFERED_INGRESS_REPLAY_STALE_MS = parseInt(process.env['BUFFERED_INGRESS_REPLAY_STALE_MS'] ?? '', 10) || 90_000;

/**
 * An active turn older than this threshold is treated as dead/stuck for rescue
 * purposes. A legitimate heavy LLM call may take up to ~3 minutes; 4× the stale
 * follower threshold (default 6 min) gives plenty of headroom before we override.
 */
const ACTIVE_TURN_STALE_MS = BUFFERED_INGRESS_REPLAY_STALE_MS * 4;

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
      const nowMs = Date.now();
      const [deliverableOverseerInstanceId, activeTurnsForUser] = await Promise.all([
        resolveDeliverableOverseerInstanceId(client, queuedFollower.userId),
        getActiveTurnStagesForUser(queuedFollower.userId),
      ]);

      // Only skip rescue if there are active turns that are genuinely still in progress.
      // If every "active" turn is itself older than ACTIVE_TURN_STALE_MS, it is likely
      // dead or stuck (e.g. a prior rescue instance whose LLM call hung). In that case
      // we must proceed with rescue to break the deadlock — otherwise the stale
      // instance permanently blocks all queued followers until its 15-min TTL expires.
      const genuinelyActiveTurns = activeTurnsForUser.filter(
        (turn) => nowMs - turn.startedAtMs < ACTIVE_TURN_STALE_MS,
      );

      if (genuinelyActiveTurns.length > 0) {
        continue;
      }

      let replayInstanceId: string;
      let replaySource: 'buffered-ingress-replay' | 'buffered-ingress-auto-force-new';

      if (deliverableOverseerInstanceId) {
        await client.terminate(
          deliverableOverseerInstanceId,
          `Automatic buffered follower rescue for ${queuedFollower.correlationId}`,
        );

        replayInstanceId = `overseer-${queuedFollower.userId}-buffered-${crypto.randomUUID().slice(0, 8)}`;
        await client.startNew('overseer', { instanceId: replayInstanceId, input: queuedFollower.event });
        await signalMindSessionAcquire(client, queuedFollower.userId, {
          instanceId: replayInstanceId,
          correlationId: queuedFollower.correlationId,
          source: 'buffered-ingress-auto-force-new',
        });
        replaySource = 'buffered-ingress-auto-force-new';
      } else {
        replayInstanceId = `overseer-${queuedFollower.userId}-buffered-${crypto.randomUUID().slice(0, 8)}`;

        await client.startNew('overseer', { instanceId: replayInstanceId, input: queuedFollower.event });
        await signalMindSessionAcquire(client, queuedFollower.userId, {
          instanceId: replayInstanceId,
          correlationId: queuedFollower.correlationId,
          source: 'buffered-ingress-replay',
        });
        replaySource = 'buffered-ingress-replay';
      }

      await markBufferedNewMessageReplayed(queuedFollower.docId, queuedFollower.userId, replayInstanceId);

      trackEvent({
        name: 'BufferedIngressFallbackReplayed',
        correlationId: queuedFollower.correlationId,
        userId: queuedFollower.userId,
        properties: {
          instanceId: replayInstanceId,
          source: replaySource,
        },
      });
    }
  },
});