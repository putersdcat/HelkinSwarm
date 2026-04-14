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

  const mapPath = join(process.cwd(), 'config', 'user-map.json');
  const raw = await readFile(mapPath, 'utf-8');
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
          'User map loaded but has 0 enabled users — routing offline. Update config/user-map.json with at least one enabled route.',
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