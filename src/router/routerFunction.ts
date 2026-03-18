// Global Teams Router — routes incoming Bot Framework activities to user-specific stamps.
// This runs as a SEPARATE Azure Function App on the Consumption plan (not inside stamps).
// Routing key: activity.from.aadObjectId → user-map.json → stamp endpoint.
// Spec ref: 0q-Multi-Instance-Architecture.md

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Zod schema for the user-map
const UserEntrySchema = z.object({
  alias: z.string().regex(/^[a-z0-9]{4}$/),
  upn: z.string(),
  endpoint: z.string().url(),
  enabled: z.boolean(),
});

const UserMapSchema = z.object({
  version: z.number(),
  users: z.record(z.string().uuid(), UserEntrySchema),
});

type UserMap = z.infer<typeof UserMapSchema>;

// Minimal schema for extracting the routing key from the activity
const ActivityRoutingSchema = z.object({
  from: z.object({
    aadObjectId: z.string().uuid().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
  }),
});

// Cached user-map (reloaded on cold start or via timer)
let cachedUserMap: UserMap | undefined;
let lastLoadTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadUserMap(): Promise<UserMap> {
  const now = Date.now();
  if (cachedUserMap && now - lastLoadTime < CACHE_TTL_MS) {
    return cachedUserMap;
  }

  // In production, user-map.json is bundled at the root of the function app
  const mapPath = join(process.cwd(), 'config', 'user-map.json');
  const raw = await readFile(mapPath, 'utf-8');
  cachedUserMap = UserMapSchema.parse(JSON.parse(raw));
  lastLoadTime = now;
  return cachedUserMap;
}

app.http('router', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'messages',
  handler: async (
    req: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> => {
    let activityBody: unknown;
    try {
      activityBody = await req.json();
    } catch {
      return { status: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    // Extract routing key
    const parsed = ActivityRoutingSchema.safeParse(activityBody);
    if (!parsed.success) {
      context.warn('Activity missing routing fields:', parsed.error.message);
      return {
        status: 400,
        body: JSON.stringify({ error: 'Missing activity.from fields' }),
      };
    }

    const aadObjectId = parsed.data.from.aadObjectId;
    if (!aadObjectId) {
      context.warn('Activity has no aadObjectId — cannot route');
      return {
        status: 403,
        body: JSON.stringify({
          error: 'No Entra Object ID on activity. Sign in to Teams and try again.',
        }),
      };
    }

    // Look up user in the map
    let userMap: UserMap;
    try {
      userMap = await loadUserMap();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      context.error('Failed to load user-map:', message);
      return { status: 500, body: JSON.stringify({ error: 'Router config error' }) };
    }

    const userEntry = userMap.users[aadObjectId];
    if (!userEntry) {
      context.warn(`Unknown user: ${aadObjectId}`);
      return {
        status: 403,
        body: JSON.stringify({
          error: 'You are not registered with HelkinSwarm. Contact the operator.',
        }),
      };
    }

    if (!userEntry.enabled) {
      context.warn(`User ${aadObjectId} is disabled`);
      return {
        status: 403,
        body: JSON.stringify({ error: 'Your HelkinSwarm instance is disabled.' }),
      };
    }

    // Proxy the activity to the user's stamp endpoint
    context.log(
      `Routing ${aadObjectId} (alias=${userEntry.alias}) → ${userEntry.endpoint}`,
    );

    // Forward all original headers (especially Authorization for Bot Framework validation)
    const forwardHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      forwardHeaders['Authorization'] = authHeader;
    }

    try {
      const response = await fetch(userEntry.endpoint, {
        method: 'POST',
        headers: forwardHeaders,
        body: JSON.stringify(activityBody),
      });

      const responseBody = await response.text();
      return {
        status: response.status,
        body: responseBody,
        headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/json' },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      context.error(`Proxy to ${userEntry.endpoint} failed:`, message);
      return {
        status: 502,
        body: JSON.stringify({ error: 'Failed to reach user stamp' }),
      };
    }
  },
});
