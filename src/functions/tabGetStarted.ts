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

app.http('tab-get-started', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'tab/get-started',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const userId = req.headers.get('x-helkinswarm-user-id');
    if (!userId || !(await isOwnerUserId(userId))) {
      return { status: 403, jsonBody: { error: 'Owner-only endpoint.' } };
    }

    const env = getEnvConfig();

    return {
      status: 200,
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
