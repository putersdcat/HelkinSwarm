// Pending Intent Replay Timer — replays queued turns into the overseer (#273).
// Runs every 5 minutes. Picks up intents that were queued when the overseer
// was unreachable and replays them via NewMessage event raise.
// Spec ref: ADDENDA-06, Issue #116, #273

import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import * as df from 'durable-functions';
import {
  getUnprocessedIntents,
} from '../orchestrator/pendingIntentStore.js';
import { replayPendingIntent } from '../orchestrator/pendingIntentReplay.js';

// ---------------------------------------------------------------------------
// Timer — every 5 minutes
// ---------------------------------------------------------------------------

app.timer('pendingIntentReplayTimer', {
  schedule: '0 */5 * * * *', // Every 5 minutes
  extraInputs: [df.input.durableClient()],
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const client = df.getClient(context);

    const intents = await getUnprocessedIntents();
    if (intents.length === 0) return;

    context.log(`[pendingIntentReplay] Found ${intents.length} unprocessed intent(s)`);

    const stats = { replayed: 0, skipped: 0, failed: 0 };

    for (const intent of intents) {
      const result = await replayPendingIntent(client, intent, 'pending-intent-replay-timer');

      if (result.outcome === 'replayed') {
        stats.replayed++;
        context.log(`[pendingIntentReplay] Replayed ${intent.trackingId} → ${result.instanceId ?? 'overseer'}`);
      } else if (result.outcome === 'skipped') {
        stats.skipped++;
        context.log(`[pendingIntentReplay] Skipping ${intent.trackingId}: ${result.reason}`);
      } else {
        stats.failed++;
        context.log(`[pendingIntentReplay] ${result.outcome} ${intent.trackingId}: ${result.reason}`);
      }
    }

    if (stats.replayed > 0 || stats.failed > 0) {
      context.log(`[pendingIntentReplay] Complete: replayed=${stats.replayed}, skipped=${stats.skipped}, failed=${stats.failed}`);
    }
  },
});
