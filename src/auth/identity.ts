// Centralized identity service — singleton credential for all Azure SDK clients.
// Returns UAMI when AZURE_CLIENT_ID is set (production), DefaultAzureCredential locally.
// Spec ref: 11-Authentication-Identity.md

import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import type { TokenCredential, AccessToken, GetTokenOptions } from '@azure/identity';
import { getEnvConfig } from '../config/envConfig.js';

// ---------------------------------------------------------------------------
// Singleton credential
// ---------------------------------------------------------------------------

let _credential: TokenCredential | undefined;
let _boundedCredential: TokenCredential | undefined;

/**
 * Returns the shared Azure credential singleton (raw, no timeout wrapper).
 * Prefer `getBoundedCredential()` for SDK clients that call `getToken()` internally.
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

/**
 * Returns a credential that wraps `getToken()` with TOKEN_ACQUIRE_TIMEOUT_MS.
 * Use this for SDK clients (Cosmos, etc.) that call `credential.getToken()` internally
 * without their own timeout protection (#327).
 */
export function getBoundedCredential(): TokenCredential {
  if (!_boundedCredential) {
    const inner = getCredential();
    _boundedCredential = {
      async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken> {
        const scopeKey = Array.isArray(scopes) ? scopes.join(' ') : scopes;
        // Check our own cache first — avoids hitting the credential at all for warm tokens.
        const cached = tokenCache.get(scopeKey);
        if (cached && cached.expiresAt > Date.now() + 60_000) {
          return { token: cached.token, expiresOnTimestamp: cached.expiresAt };
        }

        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          inner.getToken(scopes, options),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const err = new Error(`BoundedCredential: token acquisition timed out after ${TOKEN_ACQUIRE_TIMEOUT_MS}ms`);
              err.name = 'TimeoutError';
              reject(err);
            }, TOKEN_ACQUIRE_TIMEOUT_MS);
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });

        if (result?.token) {
          tokenCache.set(scopeKey, { token: result.token, expiresAt: result.expiresOnTimestamp });
        }
        return result!;
      },
    };
  }
  return _boundedCredential;
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
  _boundedCredential = undefined;
}
