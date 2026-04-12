// Entra ID Directory skill handlers — Microsoft Graph read operations.
// Spec ref: docs/05-Capabilities-Framework.md, docs/11-Authentication-Identity.md
// Issue: #243
//
// Scope requirements:
//   - entra_get_my_profile: User.Read (user-delegated via GraphOAuth)
//   - entra_find_people: User.ReadBasic.All (app-level via managed identity)
//
// Auth: entra_get_my_profile uses user-delegated Graph token via GraphOAuth.
//       entra_find_people uses app token from managed identity (no user OAuth required).

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { getGraphTokenForUser } from '../../src/auth/graphTokenHelper.js';
import { isPlaceholderScopedToken } from '../../src/auth/scopedTokenMinter.js';
import { getCredential } from '../../src/auth/identity.js';
import { z } from 'zod';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ---------------------------------------------------------------------------
// Token resolution — mirrors Outlook skill pattern
// ---------------------------------------------------------------------------

async function resolveToken(args: Record<string, unknown>): Promise<string> {
  const userId = typeof args['userId'] === 'string' ? args['userId'] : undefined;
  const scopedToken = typeof args['_scopedToken'] === 'string' ? args['_scopedToken'] : undefined;

  if (scopedToken && !isPlaceholderScopedToken(scopedToken)) {
    return scopedToken;
  }

  if (!userId) {
    throw new Error(
      'Entra skill requires a linked Microsoft account. ' +
      'Please type "/link" to connect your account first.',
    );
  }

  const token = await getGraphTokenForUser(userId);
  if (!token) {
    throw new Error(
      'Microsoft account not linked or token expired. ' +
      'Please type "/link" to connect your account.',
    );
  }
  return token;
}

// ---------------------------------------------------------------------------
// Graph fetch helper with structured error handling
// ---------------------------------------------------------------------------

async function graphGet(token: string, path: string): Promise<unknown> {
  const url = `${GRAPH_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json() as { error?: { message?: string } };
      detail = err.error?.message ?? '';
    } catch {
      // ignore parse error
    }
    throw new Error(`Graph ${path} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }

  return response.json() as unknown;
}

// ---------------------------------------------------------------------------
// Zod schemas for Graph API response validation
// ---------------------------------------------------------------------------

const UserProfileSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  mail: z.string().optional(),
  userPrincipalName: z.string().optional(),
  jobTitle: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  officeLocation: z.string().nullable().optional(),
  mobilePhone: z.string().nullable().optional(),
  businessPhones: z.array(z.string()).optional(),
}).passthrough();

const ManagerSchema = z.object({
  displayName: z.string().optional(),
  mail: z.string().optional(),
  jobTitle: z.string().nullable().optional(),
}).passthrough();

const UserSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable().optional(),
  mail: z.string().nullable().optional(),
  userPrincipalName: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
}).passthrough();

const UsersResponseSchema = z.object({
  value: z.array(UserSchema),
}).passthrough();

// ---------------------------------------------------------------------------
// Tool: entra_get_my_profile
// ---------------------------------------------------------------------------

export const entra_get_my_profile: ToolHandler = async (args) => {
  const token = await resolveToken(args);

  // Fetch user profile and manager in parallel
  const [profileRaw, managerRaw] = await Promise.allSettled([
    graphGet(token, '/me?$select=id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,mobilePhone,businessPhones'),
    graphGet(token, '/me/manager?$select=displayName,mail,jobTitle'),
  ]);

  const profile = UserProfileSchema.parse(
    profileRaw.status === 'fulfilled' ? profileRaw.value : {},
  );

  const manager = managerRaw.status === 'fulfilled'
    ? ManagerSchema.safeParse(managerRaw.value).data
    : undefined;

  const lines: string[] = [];
  lines.push(`**${profile.displayName ?? 'Unknown'}**`);

  if (profile.mail ?? profile.userPrincipalName) {
    lines.push(`📧 ${profile.mail ?? profile.userPrincipalName}`);
  }
  if (profile.jobTitle) {
    lines.push(`💼 ${profile.jobTitle}`);
  }
  if (profile.department) {
    lines.push(`🏢 ${profile.department}`);
  }
  if (profile.officeLocation) {
    lines.push(`📍 ${profile.officeLocation}`);
  }

  const phones: string[] = [];
  if (profile.mobilePhone) phones.push(`📱 ${profile.mobilePhone}`);
  if (profile.businessPhones && profile.businessPhones.length > 0) {
    phones.push(`☎️ ${profile.businessPhones[0]}`);
  }
  if (phones.length > 0) lines.push(phones.join('  '));

  if (manager?.displayName) {
    const mgr = [manager.displayName, manager.jobTitle].filter(Boolean).join(', ');
    lines.push(`👤 Manager: ${mgr}`);
  }

  lines.push(`\n_Entra ID: ${profile.id}_`);

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Tool: entra_find_people
// ---------------------------------------------------------------------------

const FindPeopleArgsSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(5).optional(),
});

export const entra_find_people: ToolHandler = async (args) => {
  const { query, limit } = FindPeopleArgsSchema.parse(args);
  const maxResults = limit ?? 5;

  // Use managed identity app token (User.ReadBasic.All) for directory search.
  // This avoids the delegated OAuth token requirement and covers all org users.
  const tokenResult = await getCredential().getToken('https://graph.microsoft.com/.default');
  if (!tokenResult?.token) {
    throw new Error('Failed to acquire app token for directory search.');
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `${GRAPH_BASE}/users?$search="displayName:${encodedQuery}"&$count=true&$top=${maxResults}&$select=id,displayName,mail,userPrincipalName,jobTitle,department`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${tokenResult.token}`,
      'Accept': 'application/json',
      'ConsistencyLevel': 'eventual',
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json() as { error?: { message?: string } };
      detail = err.error?.message ?? '';
    } catch { /* ignore */ }
    throw new Error(`Directory search failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }

  const raw = await response.json() as unknown;
  const parsed = UsersResponseSchema.parse(raw);

  if (parsed.value.length === 0) {
    return `No people found in the directory for "${query}".`;
  }

  const items = parsed.value.map((u, i) => {
    const email = u.mail ?? u.userPrincipalName ?? '';
    const parts = [
      `**${u.displayName ?? 'Unknown'}**`,
      u.jobTitle ? `*${u.jobTitle}*` : null,
      u.department ? `Dept: ${u.department}` : null,
      email ? `📧 ${email}` : null,
    ].filter(Boolean).join(' · ');
    return `${i + 1}. ${parts}`;
  });

  return `People matching "${query}" in the organization directory:\n\n${items.join('\n')}`;
};
