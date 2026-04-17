// Swarm per-turn user info resolver (#672).
// Resolves the `## User Info` shard payload for a given userId by consulting
// config/user-map.json and application RBAC. Call this once at activity start
// and thread the result into every system-prompt rebuild across rounds.
// Spec ref: docs/0zh §3.4

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { getUserRole } from '../../auth/roles.js';
import type { SwarmUserInfoPayload } from './swarmTypes.js';

const UserMapEntrySchema = z.object({
  alias: z.string().optional(),
  upn: z.string().optional(),
  displayName: z.string().optional(),
  location: z.string().optional(),
  enabled: z.boolean().optional(),
}).passthrough();

const UserMapSchema = z.object({
  version: z.number().int().optional(),
  users: z.record(z.string(), UserMapEntrySchema).optional(),
}).passthrough();

type UserMapEntry = z.infer<typeof UserMapEntrySchema>;

let cached: { users: Record<string, UserMapEntry> } | null = null;

async function loadUserMap(): Promise<{ users: Record<string, UserMapEntry> }> {
  if (cached) return cached;
  try {
    const mapPath = join(process.cwd(), 'config', 'user-map.json');
    const raw = await readFile(mapPath, 'utf-8');
    const parsed = UserMapSchema.parse(JSON.parse(raw));
    cached = { users: parsed.users ?? {} };
  } catch {
    cached = { users: {} };
  }
  return cached;
}

/**
 * Resolve the per-turn User Info payload for a userId.
 * Safe to call from any swarm activity; never throws — falls back to
 * anonymous labels when user-map is missing or the user is unknown.
 */
export async function resolveSwarmUserInfo(userId: string): Promise<SwarmUserInfoPayload> {
  const [map, role] = await Promise.all([
    loadUserMap(),
    getUserRole(userId).catch(() => 'guest' as const),
  ]);

  const entry = map.users[userId] ?? {};
  const upn = entry.upn ?? '';
  const handle = entry.alias ?? (upn ? upn.split('@')[0] : userId);
  const displayName = entry.displayName ?? (upn ? upn.split('@')[0] : handle);

  return {
    displayName,
    handle,
    tier: role,
    location: entry.location,
  };
}

/** Test-only reset hook. */
export function __resetSwarmUserInfoCache(): void {
  cached = null;
}
