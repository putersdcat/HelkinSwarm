// Tab Skills backend — returns skill catalog for the Skills Library tab panel.
// Owner-only endpoint.
// Spec ref: docs/skills-system-enhancement-2026-03-24v2.md §1
// Issue: #197

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
} from '@azure/functions';
import { isOwnerUserId } from '../bot/maintenanceMode.js';
import { getSkillCatalog } from '../capabilities/capabilityLoader.js';
import { validateTabTokenFromRequest } from '../auth/tabTokenValidator.js';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

app.http('tab-skills', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/skills',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    // Cold-start guard
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

    const catalog = getSkillCatalog();

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: {
        skills: catalog,
        totalTools: catalog.reduce((sum, s) => sum + s.toolCount, 0),
      },
    };
  },
});
