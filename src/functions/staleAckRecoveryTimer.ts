import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import { recoverStaleAcks, STALE_ACK_THRESHOLD_MS } from '../bot/staleAckRecovery.js';

app.timer('staleAckRecoveryTimer', {
  schedule: '0 */5 * * * *',
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const stats = await recoverStaleAcks(STALE_ACK_THRESHOLD_MS);
    if (stats.recovered > 0 || stats.skipped > 0 || stats.failed > 0) {
      context.log(
        `[staleAckRecovery] recovered=${stats.recovered}, skipped=${stats.skipped}, failed=${stats.failed}`,
      );
    }
  },
});