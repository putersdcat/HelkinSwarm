// Subscription Renewal Timer — periodically renews Graph subscriptions before expiry.
// Runs every 2 hours, finds subscriptions expiring within 4 hours, and extends them.
// Spec ref: 0h-Long-Running-Workflows.md §3 (automatic renewal), Issue #73

import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import { listActiveHooks } from '../orchestrator/hookCatalog.js';
import { renewGraphSubscription } from '../integrations/graphSubscriptionManager.js';
import { trackEvent } from '../observability/telemetry.js';

const RENEWAL_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours before expiry

app.timer('subscriptionRenewalTimer', {
  schedule: '0 0 */2 * * *', // Every 2 hours
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('[subscriptionRenew] Starting Graph subscription renewal sweep');

    // Find all active graphSubscription hooks across all users
    // For now, we only have a single owner user — extend when multi-user is added
    const ownerUserId = process.env['OWNER_USER_ID'];
    if (!ownerUserId) {
      context.log('[subscriptionRenew] No OWNER_USER_ID configured, skipping');
      return;
    }

    const hooks = await listActiveHooks(ownerUserId);
    const graphHooks = hooks.filter(
      (h) =>
        h.triggerConfig.type === 'graphSubscription' &&
        h.triggerConfig.subscriptionId,
    );

    if (graphHooks.length === 0) {
      context.log('[subscriptionRenew] No active Graph subscription hooks');
      return;
    }

    let renewed = 0;
    const now = Date.now();

    for (const hook of graphHooks) {
      const expiresAt = new Date(hook.expiresAt).getTime();
      const timeToExpiry = expiresAt - now;

      // Only renew if expiring within the renewal window
      if (timeToExpiry > RENEWAL_WINDOW_MS) continue;

      try {
        await renewGraphSubscription(
          ownerUserId,
          hook.triggerConfig.subscriptionId!,
        );

        trackEvent({
          name: 'GraphSubscriptionRenewed',
          correlationId: hook.correlationId,
          userId: ownerUserId,
          properties: {
            hookId: hook.id,
            subscriptionId: hook.triggerConfig.subscriptionId!,
            previousExpiry: hook.expiresAt,
          },
        });

        renewed++;
        context.log(`[subscriptionRenew] Renewed subscription ${hook.triggerConfig.subscriptionId} for hook ${hook.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        context.error(`[subscriptionRenew] Failed to renew hook=${hook.id}: ${msg}`);
      }
    }

    context.log(`[subscriptionRenew] Sweep complete: ${renewed}/${graphHooks.length} renewed`);
  },
});
