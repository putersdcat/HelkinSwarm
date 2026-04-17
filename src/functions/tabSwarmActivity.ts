// Tab Swarm Activity backend — returns recent swarm execution data for the
// Swarm Activity sub-tab in Control Center.
// Owner-only endpoint. Reads from 'sessions' container (type: 'swarm-execution').
// Epic: #631, Task: #635

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { isOwnerUserId } from '../bot/maintenanceMode.js';
import { validateTabTokenFromRequest } from '../auth/tabTokenValidator.js';
import { getContainer } from '../memory/cosmosClient.js';
import { getActiveTurnStagesForUser } from '../observability/orchestratorStageHealth.js';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const SESSIONS_CONTAINER = 'sessions';
const STALE_SWARM_RUNNING_RECONCILE_MS = parseInt(process.env.STALE_SWARM_RUNNING_RECONCILE_MS ?? '', 10) || 20 * 60 * 1000;

interface SwarmExecutionSummaryLike {
  id?: string;
  correlationId?: string;
  executedAt?: string;
  status?: string;
  success?: boolean;
  executionDurationMs?: number;
  persistenceWarning?: string;
}

export function reconcileSwarmExecutionForDisplay<T extends SwarmExecutionSummaryLike>(
  execution: T,
  activeCorrelationIds: ReadonlySet<string>,
  nowMs = Date.now(),
): T {
  if (execution.status !== 'running') return execution;
  const correlationId = execution.correlationId ?? '';
  if (correlationId && activeCorrelationIds.has(correlationId)) {
    return execution;
  }

  const executedMs = execution.executedAt ? Date.parse(execution.executedAt) : Number.NaN;
  if (!Number.isFinite(executedMs)) {
    return execution;
  }

  const ageMs = nowMs - executedMs;
  if (ageMs < STALE_SWARM_RUNNING_RECONCILE_MS) {
    return execution;
  }

  return {
    ...execution,
    status: 'fail',
    success: false,
    persistenceWarning: `Marked stale after ${Math.round(ageMs / 60_000)}m with no active orchestrator stage`,
  };
}

// ---------------------------------------------------------------------------
// GET /api/tab/swarm-activity — recent swarm executions (summary + optional detail)
// ---------------------------------------------------------------------------
app.http('tab-swarm-activity', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/swarm-activity',
  handler: async (req: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    let userId: string;
    try {
      userId = (await validateTabTokenFromRequest(req)).oid;
    } catch (err) {
      return {
        status: 401,
        headers: TAB_CORS_HEADERS,
        jsonBody: { error: err instanceof Error ? err.message : 'Authentication required.' },
      };
    }

    if (!(await isOwnerUserId(userId))) {
      return { status: 403, headers: TAB_CORS_HEADERS, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    try {
      const container = getContainer(SESSIONS_CONTAINER);
      const swarmId = req.query.get('swarmId');
      const nowMs = Date.now();
      const activeCorrelationIds = new Set(
        (await getActiveTurnStagesForUser(userId, nowMs)).map((entry) => entry.correlationId),
      );

      if (swarmId) {
        // Detail mode — return full execution data for a specific swarm
        const { resource } = await container.item(`swarm-${swarmId}`, userId).read();
        if (!resource) {
          return { status: 404, headers: TAB_CORS_HEADERS, jsonBody: { error: 'Swarm execution not found.' } };
        }
        const reconciled = reconcileSwarmExecutionForDisplay(resource as SwarmExecutionSummaryLike, activeCorrelationIds, nowMs);
        if (reconciled !== resource && resource.id) {
          await container.item(resource.id as string, userId).patch([
            { op: 'replace', path: '/status', value: 'fail' },
            { op: 'replace', path: '/success', value: false },
            { op: 'add', path: '/persistenceWarning', value: (reconciled.persistenceWarning ?? 'Marked stale running row') },
          ]).catch(() => { /* best effort reconciliation */ });
        }
        return { status: 200, headers: TAB_CORS_HEADERS, jsonBody: reconciled };
      }

      // List mode — return recent swarm executions (summary only).
      // Explicitly target the user's partition (partitionKey option) so the SDK sends
      // a single-partition query. Without this, ORDER BY + OFFSET/LIMIT in a
      // cross-partition fan-out can silently return a partial result set.
      const { resources } = await container.items
        .query(
          {
            query: `SELECT c.id, c.swarmId, c.correlationId, c.userQuery, c.executedAt,
                           c.status, c.success, c.agentCount, c.totalTokensUsed, c.executionDurationMs,
                           c.decomposerModel, c.leaderModel, c.leaderAgentsHeardFrom, c.persistenceWarning
                    FROM c
                    WHERE c.type = @type AND c.userId = @userId
                    ORDER BY c.executedAt DESC
                    OFFSET 0 LIMIT 50`,
            parameters: [
              { name: '@type', value: 'swarm-execution' },
              { name: '@userId', value: userId },
            ],
          },
          { partitionKey: userId },
        )
        .fetchAll();

      const executions = resources.map((resource) =>
        reconcileSwarmExecutionForDisplay(resource as SwarmExecutionSummaryLike, activeCorrelationIds, nowMs),
      );
      const staleRows = executions.filter((execution, index) => execution !== resources[index] && !!execution.id);
      if (staleRows.length > 0) {
        await Promise.allSettled(staleRows.map((execution) =>
          container.item(execution.id as string, userId).patch([
            { op: 'replace', path: '/status', value: 'fail' },
            { op: 'replace', path: '/success', value: false },
            { op: 'add', path: '/persistenceWarning', value: execution.persistenceWarning ?? 'Marked stale running row' },
          ])));
      }

      return {
        status: 200,
        headers: TAB_CORS_HEADERS,
        jsonBody: { executions, count: executions.length },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 500,
        headers: TAB_CORS_HEADERS,
        jsonBody: { error: `Failed to fetch swarm activity: ${message}` },
      };
    }
  },
});
