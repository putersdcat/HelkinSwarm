// Entra ID Directory skill handlers — Microsoft Graph read + write operations.
// Spec ref: docs/05-Capabilities-Framework.md, docs/11-Authentication-Identity.md
// Issues: #243, #473, #474
//
// Scope requirements (app roles on UAMI):
//   - entra_get_my_profile: User.Read (user-delegated via GraphOAuth)
//   - entra_find_people: User.ReadBasic.All (MI app token)
//   - entra_get_user: User.ReadWrite.All (MI app token)
//   - entra_list_available_licenses: Organization.Read.All (MI app token)
//   - entra_create_user: User.ReadWrite.All (MI app token)
//   - entra_assign_license: User.ReadWrite.All (MI app token)
//   - entra_check_provisioning_ready: User.ReadWrite.All (MI app token)
//
// Auth: entra_get_my_profile uses user-delegated Graph token via GraphOAuth.
//       All other tools use app token from managed identity (no user OAuth required).

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

// ---------------------------------------------------------------------------
// Shared helpers for MI-app-token-based Graph operations
// ---------------------------------------------------------------------------

async function getMiAppToken(): Promise<string> {
  const tokenResult = await getCredential().getToken('https://graph.microsoft.com/.default');
  if (!tokenResult?.token) {
    throw new Error('Failed to acquire managed identity app token for Graph API.');
  }
  return tokenResult.token;
}

async function graphRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const token = await getMiAppToken();
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  if (response.status === 204) return null; // No content

  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json() as { error?: { message?: string } };
      detail = err.error?.message ?? '';
    } catch { /* ignore */ }
    throw new Error(`Graph ${method} ${path} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }

  return response.json() as unknown;
}

/** Generate a secure temporary password meeting Azure AD complexity rules. */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digits + special;
  const rand = (chars: string) => chars[Math.floor(Math.random() * chars.length)] as string;

  // Ensure at least one of each required class
  const base: string[] = [
    rand(upper), rand(upper),
    rand(lower), rand(lower), rand(lower),
    rand(digits), rand(digits),
    rand(special),
  ];
  // Shuffle required chars
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j] as string, base[i] as string];
  }
  // Pad to 12 chars
  while (base.length < 12) base.push(rand(all));
  return base.join('');
}

// ---------------------------------------------------------------------------
// Zod schemas for new provisioning operations
// ---------------------------------------------------------------------------

const SkuSchema = z.object({
  skuId: z.string(),
  skuPartNumber: z.string().optional(),
  displayName: z.string().nullable().optional(),
  consumedUnits: z.number().optional(),
  prepaidUnits: z.object({
    enabled: z.number().optional(),
    suspended: z.number().optional(),
    warning: z.number().optional(),
  }).optional(),
}).passthrough();

const SubscribedSkusResponseSchema = z.object({
  value: z.array(SkuSchema),
}).passthrough();

const CreatedUserSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  userPrincipalName: z.string().optional(),
  mail: z.string().nullable().optional(),
}).passthrough();

// ---------------------------------------------------------------------------
// Tool: entra_list_available_licenses
// ---------------------------------------------------------------------------

export const entra_list_available_licenses: ToolHandler = async (_args) => {
  const raw = await graphRequest('GET', '/subscribedSkus?$select=skuId,skuPartNumber,displayName,consumedUnits,prepaidUnits');
  const parsed = SubscribedSkusResponseSchema.parse(raw);

  if (parsed.value.length === 0) {
    return 'No Microsoft 365 license subscriptions found in the tenant.';
  }

  const lines: string[] = ['**Available M365 License SKUs:**\n'];
  for (const sku of parsed.value) {
    const enabled = sku.prepaidUnits?.enabled ?? 0;
    const consumed = sku.consumedUnits ?? 0;
    const available = enabled - consumed;
    const name = sku.displayName ?? sku.skuPartNumber ?? sku.skuId;
    lines.push(`• **${name}** — ${available} available / ${enabled} total (SKU ID: \`${sku.skuId}\`)`);
  }

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Tool: entra_get_user
// ---------------------------------------------------------------------------

const GetUserArgsSchema = z.object({
  userIdOrUpn: z.string().min(1).max(300).describe('User object ID or userPrincipalName (UPN)'),
});

export const entra_get_user: ToolHandler = async (args) => {
  const { userIdOrUpn } = GetUserArgsSchema.parse(args);
  const encoded = encodeURIComponent(userIdOrUpn);
  const raw = await graphRequest('GET',
    `/users/${encoded}?$select=id,displayName,mail,userPrincipalName,jobTitle,department,accountEnabled,usageLocation,assignedLicenses,createdDateTime`);

  const UserDetailSchema = z.object({
    id: z.string(),
    displayName: z.string().nullable().optional(),
    mail: z.string().nullable().optional(),
    userPrincipalName: z.string().optional(),
    jobTitle: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    accountEnabled: z.boolean().optional(),
    usageLocation: z.string().nullable().optional(),
    assignedLicenses: z.array(z.object({ skuId: z.string() })).optional(),
    createdDateTime: z.string().nullable().optional(),
  }).passthrough();

  const user = UserDetailSchema.parse(raw);

  const lines: string[] = [];
  lines.push(`**${user.displayName ?? 'Unknown'}**`);
  if (user.mail ?? user.userPrincipalName) lines.push(`📧 ${user.mail ?? user.userPrincipalName}`);
  if (user.jobTitle) lines.push(`💼 ${user.jobTitle}`);
  if (user.department) lines.push(`🏢 ${user.department}`);
  lines.push(`🔘 Account: ${user.accountEnabled ? 'Enabled' : 'Disabled'}`);
  if (user.usageLocation) lines.push(`🌍 Usage Location: ${user.usageLocation}`);
  const licCount = user.assignedLicenses?.length ?? 0;
  lines.push(`📋 Assigned licenses: ${licCount}`);
  if (user.createdDateTime) lines.push(`📅 Created: ${user.createdDateTime.slice(0, 10)}`);
  lines.push(`\n_Entra ID: ${user.id}_`);

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Tool: entra_create_user
// ---------------------------------------------------------------------------

const CreateUserArgsSchema = z.object({
  displayName: z.string().min(1).max(256).describe('Full display name of the new user'),
  userPrincipalName: z.string().min(5).max(256).describe('UPN — must match a verified domain, e.g. firstname.lastname@yourdomain.com'),
  mailNickname: z.string().min(1).max(64).describe('Mail alias (no @ or domain), e.g. firstname.lastname'),
  usageLocation: z.string().length(2).describe('ISO 3166-1 alpha-2 country code required before license assignment, e.g. "US"'),
  jobTitle: z.string().max(128).optional().describe('Job title for the new user'),
  department: z.string().max(128).optional().describe('Department of the new user'),
  password: z.string().min(8).max(256).optional().describe('Initial password. If omitted, a secure temporary password is generated'),
});

export const entra_create_user: ToolHandler = async (args) => {
  const parsed = CreateUserArgsSchema.parse(args);
  const tempPassword = parsed.password ?? generateTempPassword();

  const createBody: Record<string, unknown> = {
    accountEnabled: true,
    displayName: parsed.displayName,
    mailNickname: parsed.mailNickname,
    userPrincipalName: parsed.userPrincipalName,
    usageLocation: parsed.usageLocation,
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password: tempPassword,
    },
  };
  if (parsed.jobTitle) createBody['jobTitle'] = parsed.jobTitle;
  if (parsed.department) createBody['department'] = parsed.department;

  const raw = await graphRequest('POST', '/users', createBody);
  const user = CreatedUserSchema.parse(raw);

  const lines: string[] = [];
  lines.push(`✅ **User created successfully**`);
  lines.push(`**Name:** ${user.displayName ?? parsed.displayName}`);
  lines.push(`**UPN:** ${user.userPrincipalName ?? parsed.userPrincipalName}`);
  lines.push(`**Entra ID:** ${user.id}`);
  lines.push(`**Usage Location:** ${parsed.usageLocation}`);
  lines.push(`**Temp Password:** \`${tempPassword}\``);
  lines.push(`\n⚠️ The user must change their password on first sign-in.`);
  lines.push(`Next step: assign an M365 license using \`entra_assign_license\` with SKU ID from \`entra_list_available_licenses\`.`);

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Tool: entra_assign_license
// ---------------------------------------------------------------------------

const AssignLicenseArgsSchema = z.object({
  userIdOrUpn: z.string().min(1).max(300).describe('User object ID or UPN to assign a license to'),
  skuId: z.string().uuid().describe('License SKU ID (GUID) — obtain from entra_list_available_licenses'),
});

export const entra_assign_license: ToolHandler = async (args) => {
  const { userIdOrUpn, skuId } = AssignLicenseArgsSchema.parse(args);

  // Preflight: verify SKU exists and has available seats before consuming one.
  const skusRaw = await graphRequest('GET', '/subscribedSkus?$select=skuId,skuPartNumber,displayName,consumedUnits,prepaidUnits');
  const skus = SubscribedSkusResponseSchema.parse(skusRaw);
  const sku = skus.value.find((s) => s.skuId === skuId);

  if (!sku) {
    throw new Error(
      `License SKU ${skuId} not found in the tenant. Use entra_list_available_licenses to list valid SKU IDs.`,
    );
  }

  const enabled = sku.prepaidUnits?.enabled ?? 0;
  const consumed = sku.consumedUnits ?? 0;
  const available = enabled - consumed;
  const skuName = sku.displayName ?? sku.skuPartNumber ?? skuId;

  if (available <= 0) {
    throw new Error(
      `No available seats for "${skuName}" (${skuId}). ${consumed}/${enabled} seats consumed. Purchase additional licenses before assigning.`,
    );
  }

  const encoded = encodeURIComponent(userIdOrUpn);
  await graphRequest('POST', `/users/${encoded}/assignLicense`, {
    addLicenses: [{ skuId }],
    removeLicenses: [],
  });

  return [
    `✅ **License assigned successfully**`,
    `User: \`${userIdOrUpn}\``,
    `License: ${skuName} (${available - 1} seats remaining after this assignment)`,
    `\nThe assigned license will provision Exchange Online and other M365 services. Mailbox creation typically completes within 30 minutes (may take up to 24 hours).`,
    `Use \`entra_check_provisioning_ready\` to confirm when the mailbox is fully provisioned.`,
  ].join('\n');
};

// ---------------------------------------------------------------------------
// Tool: entra_check_provisioning_ready
// ---------------------------------------------------------------------------

const CheckProvisioningArgsSchema = z.object({
  userIdOrUpn: z.string().min(1).max(300).describe('User object ID or UPN to check provisioning status for'),
});

const ProvisionedPlanSchema = z.object({
  servicePlanId: z.string().optional(),
  servicePlanName: z.string().optional(),
  provisioningStatus: z.string().optional(),
  capabilityStatus: z.string().optional(),
}).passthrough();

const ProvisioningUserSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable().optional(),
  userPrincipalName: z.string().optional(),
  accountEnabled: z.boolean().optional(),
  mail: z.string().nullable().optional(),
  assignedLicenses: z.array(z.object({ skuId: z.string() })).optional(),
  proxyAddresses: z.array(z.string()).optional(),
  provisionedPlans: z.array(ProvisionedPlanSchema).optional(),
}).passthrough();

export const entra_check_provisioning_ready: ToolHandler = async (args) => {
  const { userIdOrUpn } = CheckProvisioningArgsSchema.parse(args);
  const encoded = encodeURIComponent(userIdOrUpn);
  const raw = await graphRequest('GET',
    `/users/${encoded}?$select=id,displayName,userPrincipalName,accountEnabled,mail,assignedLicenses,proxyAddresses,provisionedPlans`);

  const user = ProvisioningUserSchema.parse(raw);

  const licenseCount = user.assignedLicenses?.length ?? 0;
  const hasMailbox = typeof user.mail === 'string' && user.mail.length > 0;
  const accountEnabled = user.accountEnabled ?? true;

  const activePlans = (user.provisionedPlans ?? []).filter(
    (p) => p.capabilityStatus === 'Enabled' && p.provisioningStatus === 'Success',
  );

  let statusLabel: string;
  let statusDetail: string;

  if (!accountEnabled) {
    statusLabel = 'DISABLED';
    statusDetail = 'Account is disabled — enable the account before checking provisioning state.';
  } else if (licenseCount === 0) {
    statusLabel = 'NOT STARTED';
    statusDetail = 'No M365 license has been assigned. Use `entra_assign_license` to start provisioning.';
  } else if (!hasMailbox) {
    statusLabel = 'PROVISIONING';
    statusDetail =
      'License assigned but Exchange Online mailbox not yet provisioned. ' +
      'Mailbox creation typically completes within 30 minutes of license assignment ' +
      '(up to 24 hours in some cases). Re-check shortly.';
  } else {
    statusLabel = 'READY';
    statusDetail = 'User account and Exchange Online mailbox are fully provisioned.';
  }

  const lines: string[] = [];
  lines.push(`**Provisioning Status: ${statusLabel}**`);
  lines.push(statusDetail);
  lines.push('');
  lines.push(`- Account enabled: ${accountEnabled ? 'Yes' : 'No'}`);
  lines.push(`- Licenses assigned: ${licenseCount}`);
  lines.push(`- Mailbox (mail): ${hasMailbox ? user.mail : 'not yet provisioned'}`);

  const smtpAddresses = (user.proxyAddresses ?? [])
    .filter((a) => a.toLowerCase().startsWith('smtp:'))
    .map((a) => a.replace(/^smtp:/i, ''));
  if (smtpAddresses.length > 0) {
    lines.push(`- Proxy SMTP addresses: ${smtpAddresses.join(', ')}`);
  }

  lines.push(`- Active M365 service plans: ${activePlans.length}`);
  lines.push(`\n_Object ID: ${user.id}_`);

  return lines.join('\n');
};
