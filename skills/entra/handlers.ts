// Entra ID Directory skill handlers — Microsoft Graph delegated read operations.
// Spec ref: docs/05-Capabilities-Framework.md, docs/11-Authentication-Identity.md
// Issue: #243
//
// Scope requirements:
//   - entra_get_my_profile: User.Read (already in GraphOAuth consent)
//   - entra_find_people: People.Read (requires OAuth scope update + re-consent)
//
// Auth: user-delegated Graph token via GraphOAuth Bot Framework connection.
//       Falls back to scoped token if injected by orchestrator (#318).

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { getGraphTokenForUser } from '../../src/auth/graphTokenHelper.js';
import { isPlaceholderScopedToken } from '../../src/auth/scopedTokenMinter.js';
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

const PersonSchema = z.object({
  displayName: z.string().optional(),
  emailAddresses: z.array(z.object({
    address: z.string().optional(),
    name: z.string().optional(),
  })).optional(),
  jobTitle: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  phones: z.array(z.object({
    number: z.string().optional(),
    type: z.string().optional(),
  })).optional(),
}).passthrough();

const PeopleResponseSchema = z.object({
  value: z.array(PersonSchema),
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

  const token = await resolveToken(args);

  const encodedQuery = encodeURIComponent(query);
  const raw = await graphGet(
    token,
    `/me/people?$search="${encodedQuery}"&$top=${maxResults}&$select=displayName,emailAddresses,jobTitle,department,phones`,
  );

  const parsed = PeopleResponseSchema.parse(raw);

  if (parsed.value.length === 0) {
    return `No people found in your Entra directory for "${query}".`;
  }

  const items = parsed.value.map((p, i) => {
    const email = p.emailAddresses?.find((e) => e.address)?.address ?? '';
    const phone = p.phones?.find((ph) => ph.number)?.number ?? '';
    const parts = [
      `**${p.displayName ?? 'Unknown'}**`,
      p.jobTitle ? `*${p.jobTitle}*` : null,
      p.department ? `Dept: ${p.department}` : null,
      email ? `📧 ${email}` : null,
      phone ? `📱 ${phone}` : null,
    ].filter(Boolean).join(' · ');
    return `${i + 1}. ${parts}`;
  });

  return `People matching "${query}" in your organization:\n\n${items.join('\n')}`;
};
