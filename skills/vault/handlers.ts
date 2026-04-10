// vault skill handlers — Azure Key Vault operations on the user vault.
// Spec ref: docs/0d-Enhanced-Safety-Segregation-Delegated-Identity-and-SkillForge.md
// Issue: #178
//
// Auth: UAMI credential (ManagedIdentityCredential when AZURE_CLIENT_ID is set,
//       DefaultAzureCredential in local dev) — Secrets Officer on the user vault.
// KV:   USER_VAULT_KEY_VAULT_URI env var (set by Bicep, points to helkinswarm-uv-{alias})

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import { z } from 'zod';

const KV_API_VERSION = '7.4';

// ---------------------------------------------------------------------------
// Credential singleton — mirrors src/auth/identity.ts pattern for skill isolation
// ---------------------------------------------------------------------------

let _cred: TokenCredential | undefined;

function getVaultCredential(): TokenCredential {
  if (!_cred) {
    const clientId = process.env['AZURE_CLIENT_ID'];
    _cred = clientId
      ? new ManagedIdentityCredential({ clientId })
      : new DefaultAzureCredential();
  }
  return _cred;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getVaultBaseUrl(): string {
  const uri = process.env['USER_VAULT_KEY_VAULT_URI'];
  if (!uri) {
    throw new Error(
      'User vault not configured — USER_VAULT_KEY_VAULT_URI is not set. ' +
      'Deploy the stamp Bicep to provision the user vault Key Vault.',
    );
  }
  return uri.replace(/\/$/, ''); // strip trailing slash
}

async function getKvToken(): Promise<string> {
  const cred = getVaultCredential();
  const tokenResponse = await cred.getToken('https://vault.azure.net/.default', {
    abortSignal: AbortSignal.timeout(8_000),
  });
  if (!tokenResponse) {
    throw new Error('Failed to acquire Key Vault access token from managed identity.');
  }
  return tokenResponse.token;
}

async function kvRequest(
  method: 'GET' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const base = getVaultBaseUrl();
  const token = await getKvToken();
  const url = `${base}${path}?api-version=${KV_API_VERSION}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const err = await response.json() as { error?: { message?: string } };
      detail = err.error?.message ?? '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new Error(`Key Vault ${method} ${path} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }

  if (response.status === 204 || method === 'DELETE') {
    return null;
  }

  return response.json() as unknown;
}

// ---------------------------------------------------------------------------
// Zod schemas for KV REST API response validation
// ---------------------------------------------------------------------------

const KvSecretListItemSchema = z.object({
  id: z.string(),
  attributes: z.object({
    enabled: z.boolean().optional(),
  }).passthrough().optional(),
});

const KvSecretListResponseSchema = z.object({
  value: z.array(KvSecretListItemSchema),
  nextLink: z.string().optional(),
});

const KvSecretValueSchema = z.object({
  value: z.string(),
  id: z.string(),
});

// ---------------------------------------------------------------------------
// Tool: vault_list_secrets
// ---------------------------------------------------------------------------

export const vault_list_secrets: ToolHandler = async () => {
  const raw = await kvRequest('GET', '/secrets');
  const parsed = KvSecretListResponseSchema.parse(raw);

  const names = parsed.value
    .filter((s) => s.attributes?.enabled !== false)
    .map((s) => {
      // id is "https://vault.../secrets/SecretName" — extract the last segment
      const parts = s.id.split('/');
      return parts[parts.length - 1] ?? s.id;
    });

  if (names.length === 0) {
    return 'No secrets stored in the user vault.';
  }

  return `User vault secrets (${names.length}):\n${names.map((n) => `• ${n}`).join('\n')}`;
};

// ---------------------------------------------------------------------------
// Tool: vault_get_secret
// ---------------------------------------------------------------------------

const VaultGetSecretArgsSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9-]+$/, 'Secret name must be alphanumeric with hyphens only'),
});

export const vault_get_secret: ToolHandler = async (args) => {
  const { name } = VaultGetSecretArgsSchema.parse(args);

  const raw = await kvRequest('GET', `/secrets/${name}`);
  const parsed = KvSecretValueSchema.parse(raw);

  return `Secret "${name}" retrieved. Value: ${parsed.value}`;
};

// ---------------------------------------------------------------------------
// Tool: vault_store_secret
// ---------------------------------------------------------------------------

const VaultStoreSecretArgsSchema = z.object({
  name: z.string().min(1).max(127).regex(/^[a-zA-Z0-9-]+$/, 'Secret name must be alphanumeric with hyphens only'),
  value: z.string().min(1),
});

export const vault_store_secret: ToolHandler = async (args) => {
  const { name, value } = VaultStoreSecretArgsSchema.parse(args);

  await kvRequest('PUT', `/secrets/${name}`, { value });

  return `Secret "${name}" stored successfully in the user vault.`;
};

// ---------------------------------------------------------------------------
// Tool: vault_delete_secret
// ---------------------------------------------------------------------------

const VaultDeleteSecretArgsSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9-]+$/, 'Secret name must be alphanumeric with hyphens only'),
});

export const vault_delete_secret: ToolHandler = async (args) => {
  const { name } = VaultDeleteSecretArgsSchema.parse(args);

  await kvRequest('DELETE', `/secrets/${name}`);

  return `Secret "${name}" has been soft-deleted from the user vault. It can be recovered within 90 days.`;
};
