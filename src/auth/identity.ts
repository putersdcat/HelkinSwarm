// Centralized identity service — singleton credential for all Azure SDK clients.
// Returns UAMI when AZURE_CLIENT_ID is set (production), DefaultAzureCredential locally.
// Spec ref: 11-Authentication-Identity.md

import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import { getEnvConfig } from '../config/envConfig.js';

// ---------------------------------------------------------------------------
// Singleton credential
// ---------------------------------------------------------------------------

let _credential: TokenCredential | undefined;

/**
 * Returns the shared Azure credential singleton.
 * - Production (AZURE_CLIENT_ID set): uses UAMI via ManagedIdentityCredential
 * - Local dev (no AZURE_CLIENT_ID): falls back to DefaultAzureCredential (az login, VS Code, etc.)
 */
export function getCredential(): TokenCredential {
  if (!_credential) {
    const clientId = getEnvConfig().azureClientId;
    _credential = clientId
      ? new ManagedIdentityCredential({ clientId })
      : new DefaultAzureCredential();
  }
  return _credential;
}

// ---------------------------------------------------------------------------
// Token cache for fetch-based clients (Foundry, Content Safety)
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const TOKEN_ACQUIRE_TIMEOUT_MS = 8_000;

/**
 * Get a Bearer token string for the given resource scope.
 * Caches tokens and refreshes 60s before expiry.
 */
export async function getBearerToken(scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const credential = getCredential();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    credential.getToken(scope),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`Token acquisition timed out after ${TOKEN_ACQUIRE_TIMEOUT_MS}ms for scope: ${scope}`);
        timeoutError.name = 'TimeoutError';
        reject(timeoutError);
      }, TOKEN_ACQUIRE_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
  if (!result?.token) {
    throw new Error(`Failed to acquire token for scope: ${scope}`);
  }

  tokenCache.set(scope, {
    token: result.token,
    expiresAt: result.expiresOnTimestamp,
  });

  return result.token;
}

/** Test-only reset hook. */
export function resetIdentityCachesForTests(): void {
  tokenCache.clear();
  _credential = undefined;
}
