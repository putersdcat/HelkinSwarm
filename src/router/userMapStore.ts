import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

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

export type UserMap = z.infer<typeof UserMapSchema>;

let cachedUserMap: UserMap | undefined;
let lastLoadTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function loadUserMap(): Promise<UserMap> {
  const now = Date.now();
  if (cachedUserMap && now - lastLoadTime < CACHE_TTL_MS) {
    return cachedUserMap;
  }

  // Prefer env-injected user map (CI/production path — avoids committed PII).
  // HELKIN_USER_MAP must be the full JSON blob matching UserMapSchema.
  const envMapJson = process.env['HELKIN_USER_MAP'];
  let raw: string;
  if (envMapJson) {
    raw = envMapJson;
  } else {
    // Fall back to local file — config/user-map.json is gitignored for developers.
    // config/user-map.example.json is the committed safe template.
    const localPath = join(process.cwd(), 'config', 'user-map.json');
    const examplePath = join(process.cwd(), 'config', 'user-map.example.json');
    try {
      raw = await readFile(localPath, 'utf-8');
    } catch {
      raw = await readFile(examplePath, 'utf-8');
    }
  }

  cachedUserMap = UserMapSchema.parse(JSON.parse(raw));
  lastLoadTime = now;
  return cachedUserMap;
}

export async function getUserMapStatus(): Promise<{
  status: 'ok' | 'degraded' | 'error';
  enabledUsers: number;
  totalUsers: number;
  error: string | null;
}> {
  try {
    const userMap = await loadUserMap();
    const users = Object.values(userMap.users);
    const enabledUsers = users.filter((user) => user.enabled).length;
    if (enabledUsers === 0) {
      return {
        status: 'degraded',
        enabledUsers: 0,
        totalUsers: users.length,
        error:
          'User map loaded but has 0 enabled users — routing offline. Ensure HelkinUserMap Key Vault secret is set with valid routing data. (#652)',
      };
    }
    return {
      status: 'ok',
      enabledUsers,
      totalUsers: users.length,
      error: null,
    };
  } catch (error: unknown) {
    return {
      status: 'error',
      enabledUsers: 0,
      totalUsers: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}