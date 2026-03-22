// Tab Dashboard backend — returns service state, sessions, model routing, maintenance status.
// Owner-only endpoint for the Control Center tab panel.
// Spec ref: docs/ADDENDA/ADDENDA-03-Tab-Infrastructure-Control-Center-and-Dev-Console.md
// Issue: #141, #86

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import * as df from 'durable-functions';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import { isOwnerUserId, getMaintenanceMode } from '../bot/maintenanceMode.js';
import { getModelRouting } from '../llm/modelRouter.js';
import { getEnvConfig } from '../config/envConfig.js';
import { getLoadedCapabilitiesCount, getActiveSkills } from '../capabilities/capabilityLoader.js';
import { APP_VERSION } from '../config/version.js';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

app.http('tab-dashboard', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/dashboard',
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    // Cold-start guard: 503 while capabilities are still loading
    if (process.uptime() < 5) {
      return {
        status: 503,
        headers: { ...TAB_CORS_HEADERS, 'Retry-After': '5' },
        jsonBody: { status: 'cold-start', message: 'HelkinSwarm is starting up...', retryAfter: 5 },
      };
    }

    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, headers: TAB_CORS_HEADERS, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const client = df.getClient(context);
    const env = getEnvConfig();
    const routing = getModelRouting();
    const maintenance = await getMaintenanceMode();

    // Get orchestration instances
    const statuses = await client.getStatusAll();
    const activeStatuses = new Set<OrchestrationRuntimeStatus>([
      OrchestrationRuntimeStatus.Running,
      OrchestrationRuntimeStatus.Pending,
      OrchestrationRuntimeStatus.ContinuedAsNew,
    ]);
    const activeSessions = statuses.filter(
      (s) => s.runtimeStatus && activeStatuses.has(s.runtimeStatus),
    );

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: {
        status: 'healthy',
        uptime: process.uptime(),
        version: APP_VERSION,
        activeSessions: activeSessions.length,
        totalSessions: statuses.length,
        maintenanceMode: maintenance,
        safetyMode: env.safetyMode,
        euResidencyMode: env.euResidencyMode,
        model: {
          laneName: routing.laneName,
          primary: routing.lane.primary,
          secondary: routing.lane.secondary,
          reasoning: routing.lane.reasoning ?? null,
          embedding: routing.lane.embedding,
          vision: routing.lane.vision ?? null,
        },
        capabilities: {
          toolCount: getLoadedCapabilitiesCount(),
          activeSkills: getActiveSkills(),
        },
      },
    };
  },
});
