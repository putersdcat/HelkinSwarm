// Startup Recovery Activity — processes pending intents queued during downtime.
// Called from index.ts on Function App startup to replay messages
// that arrived while the service was offline or restarting.
// Spec ref: ADDENDA-06, Issue #116

import * as df from 'durable-functions';
import {
  getUnprocessedIntents,
  markIntentProcessing,
  markIntentProcessed,
  markIntentFailed,
  hasIdempotencyKey,
  type PendingIntent,
} from './pendingIntentStore.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Decision Matrix — determines how to handle each pending intent
// ---------------------------------------------------------------------------

interface RecoveryDecision {
  action: 'auto-execute' | 'confirm' | 'skip';
  reason: string;
}

function classifyIntent(intent: PendingIntent): RecoveryDecision {
  // Safety floor: never auto-execute high/critical risk intents
  if (intent.riskLevel === 'high' || intent.riskLevel === 'critical') {
    return { action: 'confirm', reason: 'High-risk intent requires live confirmation.' };
  }

  // Intents with external effects need confirmation
  if (intent.externalEffects.length > 0 && intent.requiresConfirmation) {
    return { action: 'confirm', reason: 'External effects require confirmation.' };
  }

  // Already failed twice — skip
  if (intent.status === 'failed' && intent.failureReason) {
    return { action: 'skip', reason: `Previously failed: ${intent.failureReason}` };
  }

  // Simple, non-destructive intents — auto-execute
  return { action: 'auto-execute', reason: 'Low-risk, no external effects.' };
}

// ---------------------------------------------------------------------------
// Activity — registered as a Durable activity callable from orchestrators
// ---------------------------------------------------------------------------

df.app.activity('startupRecoveryActivity', {
  handler: async (): Promise<{
    processed: number;
    confirmed: number;
    skipped: number;
    failed: number;
    details: Array<{ trackingId: string; action: string; reason: string }>;
  }> => {
    const intents = await getUnprocessedIntents();

    const stats = { processed: 0, confirmed: 0, skipped: 0, failed: 0 };
    const details: Array<{ trackingId: string; action: string; reason: string }> = [];

    for (const intent of intents) {
      // Dedup — skip if already processed (idempotency guard)
      const alreadyDone = await hasIdempotencyKey(intent.idempotencyKey);
      if (alreadyDone) {
        stats.skipped++;
        details.push({ trackingId: intent.trackingId, action: 'skip', reason: 'Duplicate (idempotency key already processed).' });
        continue;
      }

      const decision = classifyIntent(intent);
      details.push({ trackingId: intent.trackingId, action: decision.action, reason: decision.reason });

      switch (decision.action) {
        case 'auto-execute':
          try {
            await markIntentProcessing(intent.id, intent.userId);
            // The actual re-routing to the overseer is done by the caller (index.ts)
            // via raising a NewMessage event. This activity only marks the intent
            // as ready for processing.
            await markIntentProcessed(intent.id, intent.userId);
            stats.processed++;

            trackEvent({
              name: 'PendingIntentRecovered',
              correlationId: intent.id,
              userId: intent.userId,
              properties: {
                trackingId: intent.trackingId,
                action: 'auto-execute',
              },
            });
          } catch (err) {
            const reason = err instanceof Error ? err.message : 'Unknown error';
            await markIntentFailed(intent.id, intent.userId, reason);
            stats.failed++;
          }
          break;

        case 'confirm':
          // Mark as received — leave for proactive confirmation card
          stats.confirmed++;
          trackEvent({
            name: 'PendingIntentRecovered',
            correlationId: intent.id,
            userId: intent.userId,
            properties: {
              trackingId: intent.trackingId,
              action: 'confirm',
            },
          });
          break;

        case 'skip':
          stats.skipped++;
          break;
      }
    }

    return { ...stats, details };
  },
});
