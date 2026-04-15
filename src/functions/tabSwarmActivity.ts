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
import { getContainer } from '../memory/cosmosClient.js';
import { validateTabTokenFromRequest } from '../auth/tabTokenValidator.js';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const SESSIONS_CONTAINER = 'sessions';

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

      if (swarmId) {
        // Detail mode — return full execution data for a specific swarm
        const { resource } = await container.item(`swarm-${swarmId}`, userId).read();
        if (!resource) {
          return { status: 404, headers: TAB_CORS_HEADERS, jsonBody: { error: 'Swarm execution not found.' } };
        }
        return { status: 200, headers: TAB_CORS_HEADERS, jsonBody: resource };
      }

      // List mode — return recent swarm executions (summary only).
      // Explicitly target the user's partition (partitionKey option) so the SDK sends
      // a single-partition query. Without this, ORDER BY + OFFSET/LIMIT in a
      // cross-partition fan-out can silently return a partial result set.
      const { resources } = await container.items
        .query(
          {
            query: `SELECT c.id, c.swarmId, c.correlationId, c.userQuery, c.executedAt,
                           c.success, c.agentCount, c.totalTokensUsed, c.executionDurationMs,
                           c.decomposerModel, c.leaderModel, c.leaderAgentsHeardFrom
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

      return {
        status: 200,
        headers: TAB_CORS_HEADERS,
        jsonBody: { executions: resources, count: resources.length },
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
