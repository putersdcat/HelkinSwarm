import {
  app,
  type HttpRequest,
  type HttpResponseInit,
} from '@azure/functions';
import { validateTabTokenFromRequest, extractBearerToken } from '../auth/tabTokenValidator.js';
import { bootstrapOboSession } from '../auth/oboSessionBootstrap.js';

const TAB_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://helkinswarmtabsst.z20.web.core.windows.net',
  'Access-Control-Allow-Headers': 'x-helkinswarm-user-id, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

app.http('tab-bootstrap-obo', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'tab/bootstrap-obo',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    if (req.method === 'OPTIONS') {
      return { status: 204, headers: TAB_CORS_HEADERS };
    }

    const bearer = extractBearerToken(req.headers.get('Authorization') ?? req.headers.get('authorization'));
    if (!bearer) {
      return {
        status: 401,
        headers: TAB_CORS_HEADERS,
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
        headers: TAB_CORS_HEADERS,
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
        headers: TAB_CORS_HEADERS,
        jsonBody: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  },
});