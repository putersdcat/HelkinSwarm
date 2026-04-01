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
import {
  getSkillCatalog,
  inspectSkillInstall,
  inspectSkillUninstall,
  loadCapabilities,
} from '../capabilities/capabilityLoader.js';
import { validateTabTokenFromRequest } from '../auth/tabTokenValidator.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { searchMcpRegistryCatalog } from '../mcp/mcpRegistryCatalog.js';
import { buildMcpForgeDraftBundle } from '../mcp/mcpForgeDraft.js';
import { approveMcpForgeBundleLocally } from '../mcp/mcpForgeActivation.js';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function authenticateOwner(req: HttpRequest): Promise<{ ok: true; userId: string } | { ok: false; response: HttpResponseInit }> {
  let userId: string;
  try {
    userId = (await validateTabTokenFromRequest(req)).oid;
  } catch (err) {
    return {
      ok: false,
      response: {
        status: 401,
        headers: TAB_CORS_HEADERS,
        jsonBody: { error: err instanceof Error ? err.message : 'Authentication required.' },
      },
    };
  }

  if (!(await isOwnerUserId(userId))) {
    return {
      ok: false,
      response: { status: 403, headers: TAB_CORS_HEADERS, jsonBody: { error: 'Owner-only endpoint.' } },
    };
  }

  return { ok: true, userId };
}

async function parseJsonBody(req: HttpRequest): Promise<Record<string, unknown>> {
  try {
    return ((await req.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

app.http('tab-skill-install-readiness', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/skills/{skillId}/install-readiness',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    const auth = await authenticateOwner(req);
    if (!auth.ok) {
      return auth.response;
    }

    const skillId = req.params.skillId;
    if (!skillId) {
      return { status: 400, headers: TAB_CORS_HEADERS, jsonBody: { error: 'skillId required.' } };
    }

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: inspectSkillInstall(skillId),
    };
  },
});

app.http('tab-skill-uninstall-impact', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/skills/{skillId}/uninstall-impact',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    const auth = await authenticateOwner(req);
    if (!auth.ok) {
      return auth.response;
    }

    const skillId = req.params.skillId;
    if (!skillId) {
      return { status: 400, headers: TAB_CORS_HEADERS, jsonBody: { error: 'skillId required.' } };
    }

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: inspectSkillUninstall(skillId),
    };
  },
});

app.http('tab-skills-reload', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/skills/reload',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    const auth = await authenticateOwner(req);
    if (!auth.ok) {
      return auth.response;
    }

    toolRegistry.clear();
    const result = await loadCapabilities();

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: {
        status: 'success',
        message: `Reloaded ${result.skillsLoaded} skills and ${result.toolsRegistered} tools.`,
        ...result,
      },
    };
  },
});

app.http('tab-skills-mcp-registry-search', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/skills/mcp-registry/search',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    const auth = await authenticateOwner(req);
    if (!auth.ok) {
      return auth.response;
    }

    const body = await parseJsonBody(req);
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return { status: 400, headers: TAB_CORS_HEADERS, jsonBody: { error: 'query required.' } };
    }

    const result = await searchMcpRegistryCatalog(query, {
      limit: typeof body.limit === 'number' ? body.limit : 12,
      includeDeprecated: body.includeDeprecated === undefined ? true : Boolean(body.includeDeprecated),
      includeDeleted: Boolean(body.includeDeleted),
      forceRefresh: Boolean(body.forceRefresh),
    });

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: result,
    };
  },
});

app.http('tab-skills-mcp-forge-draft', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/skills/mcp-registry/draft',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    const auth = await authenticateOwner(req);
    if (!auth.ok) {
      return auth.response;
    }

    const body = await parseJsonBody(req);
    const candidateName = typeof body.candidateName === 'string' ? body.candidateName.trim() : '';
    if (!candidateName) {
      return { status: 400, headers: TAB_CORS_HEADERS, jsonBody: { error: 'candidateName required.' } };
    }

    const result = await buildMcpForgeDraftBundle({
      candidateName,
      userId: auth.userId,
      correlationId: crypto.randomUUID(),
      useCase: typeof body.useCase === 'string' ? body.useCase : undefined,
    });

    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: result,
    };
  },
});

app.http('tab-skills-mcp-forge-approve', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/skills/mcp-registry/approve',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    const auth = await authenticateOwner(req);
    if (!auth.ok) {
      return auth.response;
    }

    const body = await parseJsonBody(req);
    const bundlePath = typeof body.bundlePath === 'string' ? body.bundlePath.trim() : '';
    if (!bundlePath) {
      return { status: 400, headers: TAB_CORS_HEADERS, jsonBody: { error: 'bundlePath required.' } };
    }

    const result = await approveMcpForgeBundleLocally(bundlePath);
    return {
      status: 200,
      headers: TAB_CORS_HEADERS,
      jsonBody: result,
    };
  },
});
