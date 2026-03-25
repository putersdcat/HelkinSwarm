// Tab Dev Console backend — deep inspection of orchestration, hooks, relay, and sessions.
// Owner-only endpoint for the Dev Console tab panel.
// Spec ref: docs/ADDENDA/ADDENDA-03-Tab-Infrastructure-Control-Center-and-Dev-Console.md
// Issue: #86

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import { isOwnerUserId, getMaintenanceMode } from '../bot/maintenanceMode.js';
import { getEnvConfig } from '../config/envConfig.js';
import { listAllHooks } from '../orchestrator/hookCatalog.js';
import { getContainer } from '../memory/cosmosClient.js';
import { validateTabTokenFromRequest } from '../auth/tabTokenValidator.js';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function toIsoString(value: Date | string | undefined): string | null {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.toISOString();
}

// ---------------------------------------------------------------------------
// GET /api/tab/dev-console — aggregated deep inspection data
// ---------------------------------------------------------------------------
app.http('tab-dev-console', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/dev-console',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
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

    const client = df.getClient(context);
    const env = getEnvConfig();

    // --- Sessions -----------------------------------------------------------
    const statuses = await client.getStatusAll();
    const activeSet = new Set<OrchestrationRuntimeStatus>([
      OrchestrationRuntimeStatus.Running,
      OrchestrationRuntimeStatus.Pending,
      OrchestrationRuntimeStatus.ContinuedAsNew,
    ]);
    const sessions = statuses.map((s) => ({
      instanceId: s.instanceId,
      name: s.name,
      runtimeStatus: s.runtimeStatus,
      createdAt: toIsoString(s.createdTime),
      lastUpdated: toIsoString(s.lastUpdatedTime),
      isRunning: s.runtimeStatus != null && activeSet.has(s.runtimeStatus),
    }));
    sessions.sort((a, b) => {
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });

    // --- Hooks -------------------------------------------------------------
    let hooks: unknown[] = [];
    try {
      hooks = await listAllHooks(userId);
    } catch {
      context.warn('Failed to fetch hooks for dev console');
    }

    // --- Relay health (recent ide-messages count) --------------------------
    const relayStats = { total: 0, pending: 0 };
    try {
      const container = getContainer('ide-messages');
      const { resources } = await container.items
        .query({
          query: 'SELECT VALUE COUNT(1) FROM c WHERE c.createdAt > @since',
          parameters: [{ name: '@since', value: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }],
        })
        .fetchAll();
      relayStats.total = resources[0] ?? 0;

      const { resources: pendingRes } = await container.items
        .query({
          query: 'SELECT VALUE COUNT(1) FROM c WHERE c.deliveredAt = null AND c.createdAt > @since',
          parameters: [{ name: '@since', value: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }],
        })
        .fetchAll();
      relayStats.pending = pendingRes[0] ?? 0;
    } catch {
      context.warn('Failed to fetch relay stats for dev console');
    }

    // --- Maintenance -------------------------------------------------------
    const maintenance = await getMaintenanceMode();

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: {
        sessions: {
          list: sessions.slice(0, 30),
          active: sessions.filter((s) => s.isRunning).length,
          total: sessions.length,
        },
        hooks: {
          list: hooks,
          active: (hooks as Array<{ status: string }>).filter((h) => h.status === 'active').length,
          total: hooks.length,
        },
        relay: relayStats,
        maintenance,
        safetyMode: env.safetyMode,
        euResidencyMode: env.euResidencyMode,
        timestamp: new Date().toISOString(),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// POST /api/tab/sessions/:instanceId/terminate — kill a running session
// ---------------------------------------------------------------------------
app.http('tab-session-terminate', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/sessions/{instanceId}/terminate',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
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

    const instanceId = req.params.instanceId;
    if (!instanceId) {
      return { status: 400, headers: TAB_CORS_HEADERS, jsonBody: { error: 'instanceId required.' } };
    }

    const client = df.getClient(context);
    try {
      await client.terminate(instanceId, 'Terminated via Dev Console');
      return {
        status: 200,
        headers: TAB_CORS_HEADERS,
        jsonBody: { terminated: true, instanceId },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 500,
        headers: TAB_CORS_HEADERS,
        jsonBody: { terminated: false, error: msg },
      };
    }
  },
});

// ---------------------------------------------------------------------------
// GET /api/tab/traces?corr=<correlationTag> — search relay messages by tag
// ---------------------------------------------------------------------------
app.http('tab-traces', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/traces',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
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

    const corr = req.query.get('corr');

    try {
      const { getMessagesByCorrelation } = await import('../devloop/relayStore.js');
      const { getTraceTree, listRecentTraces } = await import('../observability/sessionTracer.js');

      // If no corr param, return recent traces list
      if (!corr || corr.length < 3) {
        const recent = listRecentTraces(30);
        return {
          status: 200,
          headers: TAB_CORS_HEADERS,
          jsonBody: { recent },
        };
      }

      const messages = await getMessagesByCorrelation(corr);
      const traceTree = getTraceTree(corr);

      return {
        status: 200,
        headers: TAB_CORS_HEADERS,
        jsonBody: { correlationTag: corr, messages, count: messages.length, traceTree: traceTree ?? null },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 500,
        headers: TAB_CORS_HEADERS,
        jsonBody: { error: msg },
      };
    }
  },
});
