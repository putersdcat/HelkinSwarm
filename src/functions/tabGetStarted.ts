// Tab Get Started backend — returns quickstart data for the Getting Started tab panel.
// Owner-only endpoint.
// Spec ref: docs/ADDENDA/ADDENDA-03-Tab-Infrastructure-Control-Center-and-Dev-Console.md
// Issue: #141

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
} from '@azure/functions';
import { isOwnerUserId } from '../bot/maintenanceMode.js';
import { getLoadedCapabilitiesCount, getActiveSkills } from '../capabilities/capabilityLoader.js';
import { getEnvConfig } from '../config/envConfig.js';
import { validateTabTokenFromRequest } from '../auth/tabTokenValidator.js';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

app.http('tab-get-started', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/get-started',
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

    const env = getEnvConfig();

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: {
        quickCommands: [
          { cmd: '/emergency-stop', label: 'Emergency Stop', danger: true },
          { cmd: '/reload skills', label: 'Reload Capabilities', danger: false },
          { cmd: '/status', label: 'System Status', danger: false },
          { cmd: '/link', label: 'Link Account (OAuth)', danger: false },
        ],
        capabilitiesCount: getLoadedCapabilitiesCount(),
        activeSkills: getActiveSkills(),
        safetyMode: env.safetyMode,
        skillforgeEnabled: env.skillforgeEnabled,
      },
    };
  },
});
