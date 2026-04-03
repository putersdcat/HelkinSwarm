// Stale Session Cleanup Timer — watchdog for stuck durable orchestrations (#274).
// Runs every 30 minutes. Identifies running instances with no heartbeat update beyond
// the stale threshold, logs candidates, then terminates them conservatively.
// Spec ref: 08-Orchestrator-Patterns.md

import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import * as df from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import { clearOrchestratorStagesForInstanceIds } from '../observability/orchestratorStageHealth.js';
import { trackEvent } from '../observability/telemetry.js';

/** Sessions idle longer than this are considered stale. Default: 1 hour. */
const STALE_THRESHOLD_MS = parseInt(process.env.STALE_SESSION_THRESHOLD_MS ?? '', 10) || 60 * 60 * 1000;

/** Instance name prefixes that are expected to be long-running and should not be terminated. */
const ALLOW_LONG_RUNNING = new Set([
  'maintenanceSweepTimer',
  'subscriptionRenewalTimer',
]);

app.timer('staleSessionCleanupTimer', {
  schedule: '0 */30 * * * *', // Every 30 minutes
  extraInputs: [df.input.durableClient()],
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const client = df.getClient(context);
    const correlationId = crypto.randomUUID();

    const statuses = await client.getStatusAll();

    const now = Date.now();
    const activeStatuses = new Set<OrchestrationRuntimeStatus>([
      OrchestrationRuntimeStatus.Running,
      OrchestrationRuntimeStatus.Pending,
      OrchestrationRuntimeStatus.ContinuedAsNew,
    ]);

    const candidates = statuses.filter((s) => {
      if (!s.instanceId || !s.runtimeStatus || !activeStatuses.has(s.runtimeStatus)) {
        return false;
      }
      // Skip explicitly allowed long-running orchestrations
      if (ALLOW_LONG_RUNNING.has(s.name)) {
        return false;
      }
      const lastUpdated = s.lastUpdatedTime ? new Date(s.lastUpdatedTime).getTime() : 0;
      return (now - lastUpdated) > STALE_THRESHOLD_MS;
    });

    if (candidates.length === 0) {
      context.log(`[staleSessionCleanup] No stale sessions found (threshold: ${STALE_THRESHOLD_MS}ms)`);
      return;
    }

    context.log(`[staleSessionCleanup] Found ${candidates.length} stale session(s) — terminating`);

    let terminated = 0;
    const terminatedInstanceIds: string[] = [];
    for (const candidate of candidates) {
      const ageMs = now - (candidate.lastUpdatedTime ? new Date(candidate.lastUpdatedTime).getTime() : 0);
      context.log(`[staleSessionCleanup] Terminating ${candidate.instanceId} (name=${candidate.name}, status=${candidate.runtimeStatus}, staleMs=${ageMs})`);
      try {
        await client.terminate(candidate.instanceId, `Stale session cleanup — idle for ${Math.round(ageMs / 1000)}s (threshold: ${Math.round(STALE_THRESHOLD_MS / 1000)}s)`);
        terminated++;
        terminatedInstanceIds.push(candidate.instanceId);
      } catch (err) {
        context.log(`[staleSessionCleanup] Failed to terminate ${candidate.instanceId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (terminatedInstanceIds.length > 0) {
      await clearOrchestratorStagesForInstanceIds(terminatedInstanceIds);
    }

    trackEvent({
      name: 'StaleSessionCleanup',
      correlationId,
      properties: {
        totalScanned: statuses.length,
        candidateCount: candidates.length,
        terminatedCount: terminated,
        thresholdMs: STALE_THRESHOLD_MS,
      },
    });

    context.log(`[staleSessionCleanup] Complete: scanned=${statuses.length}, candidates=${candidates.length}, terminated=${terminated}`);
  },
});
