// Stale swarm RUNNING reconciler — proactively flips orphan `running` swarm
// execution rows to `fail` so the Control Center → Swarm tab stays honest
// without relying on a tab read to trigger lazy reconciliation.
//
// Rationale (#689, #693):
//   The session orchestrator writes a `running` placeholder doc to the
//   `sessions` container BEFORE invoking the swarm sub-orchestrator, then
//   overwrites it with a terminal `ok`/`fail` status after the sub-orchestrator
//   returns. If the parent overseer dies between those two writes (deploy,
//   ContinueAsNew, replay fault, host rotation), the placeholder is never
//   reconciled and the row shows `RUNNING` indefinitely (until 72h TTL).
//
//   `tabSwarmActivity` already performs lazy reconciliation when the tab is
//   read, but that is user-driven. This timer fires on a fixed cadence so the
//   tab is honest even when nobody is looking.
//
// Strategy: cross-partition query for any `swarm-execution` doc with
// `status == 'running'` AND `executedAt` older than the reconcile window.
// Patch each one to `fail` with a clear `persistenceWarning`. Best-effort —
// individual patch failures are logged and skipped, never thrown.

import {
  app,
  type InvocationContext,
  type Timer,
} from '@azure/functions';
import { getContainer } from '../memory/cosmosClient.js';
import { trackEvent } from '../observability/telemetry.js';

const SESSIONS_CONTAINER = 'sessions';

// Mirror the lazy reconciler default in tabSwarmActivity.ts so the two stay
// in lockstep. Override via STALE_SWARM_RUNNING_RECONCILE_MS for tests/dev.
const STALE_SWARM_RUNNING_RECONCILE_MS =
  parseInt(process.env['STALE_SWARM_RUNNING_RECONCILE_MS'] ?? '', 10) || 20 * 60 * 1000;

// Hard cap on rows reconciled per sweep so a deeply backed-up state cannot
// hammer Cosmos in a single invocation.
const MAX_RECONCILE_PER_SWEEP = 100;

interface StaleSwarmRow {
  id: string;
  userId: string;
  swarmId?: string;
  correlationId?: string;
  executedAt?: string;
  status?: string;
}

export async function reconcileStaleSwarmRunningRows(
  nowMs: number = Date.now(),
): Promise<{ scanned: number; reconciled: number; failed: number }> {
  const cutoffIso = new Date(nowMs - STALE_SWARM_RUNNING_RECONCILE_MS).toISOString();
  const container = getContainer(SESSIONS_CONTAINER);

  let scanned = 0;
  let reconciled = 0;
  let failed = 0;

  try {
    const { resources } = await container.items
      .query<StaleSwarmRow>({
        query: `SELECT TOP @limit c.id, c.userId, c.swarmId, c.correlationId, c.executedAt, c.status
                FROM c
                WHERE c.type = @type
                  AND c.status = @status
                  AND c.executedAt < @cutoff`,
        parameters: [
          { name: '@type', value: 'swarm-execution' },
          { name: '@status', value: 'running' },
          { name: '@cutoff', value: cutoffIso },
          { name: '@limit', value: MAX_RECONCILE_PER_SWEEP },
        ],
      })
      .fetchAll();

    scanned = resources.length;

    for (const row of resources) {
      if (!row.id || !row.userId) continue;
      const ageMs = row.executedAt ? nowMs - Date.parse(row.executedAt) : 0;
      const ageMinutes = Math.round(ageMs / 60_000);
      try {
        await container.item(row.id, row.userId).patch([
          { op: 'replace', path: '/status', value: 'fail' },
          { op: 'replace', path: '/success', value: false },
          {
            op: 'add',
            path: '/persistenceWarning',
            value: `Reconciled by staleSwarmRunningTimer after ${ageMinutes}m with no terminal status (#693)`,
          },
        ]);
        reconciled++;
        trackEvent({
          name: 'SwarmStaleRunningReconciled',
          correlationId: row.correlationId ?? 'unknown',
          userId: row.userId,
          properties: {
            swarmId: row.swarmId ?? 'unknown',
            ageMinutes,
            source: 'timer',
          },
        });
      } catch (patchErr) {
        failed++;
        const message = patchErr instanceof Error ? patchErr.message : String(patchErr);
        console.warn(
          `[staleSwarmRunningTimer] Failed to patch ${row.id} (user=${row.userId}): ${message}`,
        );
      }
    }
  } catch (queryErr) {
    const message = queryErr instanceof Error ? queryErr.message : String(queryErr);
    console.warn(`[staleSwarmRunningTimer] Cross-partition query failed: ${message}`);
  }

  return { scanned, reconciled, failed };
}

app.timer('staleSwarmRunningTimer', {
  // Every 5 minutes — same cadence as staleAckRecoveryTimer. The reconcile
  // window itself (20m by default) provides the grace period.
  schedule: '0 */5 * * * *',
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const stats = await reconcileStaleSwarmRunningRows();
    if (stats.scanned > 0 || stats.failed > 0) {
      context.log(
        `[staleSwarmRunningTimer] scanned=${stats.scanned} reconciled=${stats.reconciled} failed=${stats.failed}`,
      );
    }
  },
});
