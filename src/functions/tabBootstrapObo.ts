import {
  app,
  type HttpRequest,
  type HttpResponseInit,
} from '@azure/functions';
import { validateTabTokenFromRequest, extractBearerToken } from '../auth/tabTokenValidator.js';
import { bootstrapOboSession } from '../auth/oboSessionBootstrap.js';

const ALLOWED_ORIGINS = new Set([
  'https://helkinswarmtabsst.z20.web.core.windows.net',
  'https://teams.cloud.microsoft',
  'https://teams.microsoft.com',
]);

function buildCorsHeaders(req: HttpRequest): Record<string, string> {
  const origin = req.headers.get('origin') ?? req.headers.get('Origin') ?? '';
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : 'https://helkinswarmtabsst.z20.web.core.windows.net';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    Vary: 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

app.http('tab-bootstrap-obo', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/bootstrap-obo',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    const corsHeaders = buildCorsHeaders(req);
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders };
    }

    const bearer = extractBearerToken(req.headers.get('Authorization') ?? req.headers.get('authorization'));
    if (!bearer) {
      return {
        status: 401,
        headers: corsHeaders,
        jsonBody: { error: 'Missing bearer token. Teams SSO is required.' },
      };
    }

    try {
      const validated = await validateTabTokenFromRequest(req);
      const correlationId = `tab-obo-${crypto.randomUUID()}`;
      const result = await bootstrapOboSession({
        userId: validated.oid,
        assertion: bearer,
        correlationId,
        source: 'teams-tab-sso',
      });

      return {
        status: 200,
        headers: corsHeaders,
        jsonBody: {
          status: 'bootstrapped',
          correlationId,
          source: result.session.source,
          scopes: result.scopes,
          expiresOn: result.expiresOn,
        },
      };
    } catch (err) {
      return {
        status: 400,
        headers: corsHeaders,
        jsonBody: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  },
});