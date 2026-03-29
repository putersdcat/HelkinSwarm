// Tab Costs backend — returns Azure Cost Management summary for Control Center > Costs.
// Owner-only endpoint.
// Spec ref: docs/0o-Microsoft-Teams-App-Expansion-with-Tabs.md
// Issue: #232

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
} from '@azure/functions';
import { isOwnerUserId } from '../bot/maintenanceMode.js';
import { validateTabTokenFromRequest } from '../auth/tabTokenValidator.js';
import { getAzureResourceGroupCostSummary } from '../integrations/azureCostManagement.js';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

app.http('tab-costs', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/costs',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    if (process.uptime() < 5) {
      return {
        status: 503,
        headers: { ...TAB_CORS_HEADERS, 'Retry-After': '5' },
        jsonBody: { status: 'cold-start', message: 'HelkinSwarm is starting up...', retryAfter: 5 },
      };
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

    const summary = await getAzureResourceGroupCostSummary();
    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: {
        ...summary,
        generatedAt: new Date().toISOString(),
      },
    };
  },
});