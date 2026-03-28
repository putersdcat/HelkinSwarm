// OBO (On-Behalf-Of) delegated token provider — exchanges Bot SSO tokens for
// user-context Graph tokens so skills can act as the user (personal email, calendar, etc.).
// Spec ref: 11-Authentication-Identity.md, Issue #29
//
// Flow:
// 1. User sends a message in Teams → Bot gets an SSO token (Teams SSO).
// 2. OBO flow exchanges SSO token → Graph access token scoped to the user.
// 3. Access tokens are 5-minute, cached via MSAL + Cosmos plugin (#30).
// 4. Refresh tokens survive container restarts (stored in Cosmos cache).

import { ConfidentialClientApplication } from '@azure/msal-node';
import type { AuthenticationResult, Configuration, AccountInfo } from '@azure/msal-node';
import { createCosmosCachePlugin } from './msalCachePlugin.js';
import { getEnvConfig } from '../config/envConfig.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OboTokenRequest {
  userId: string;
  /** The user assertion (SSO token from Teams) */
  assertion: string;
  /** Graph scopes to request, e.g. ['Mail.Read', 'Calendars.Read'] */
  scopes: string[];
  correlationId: string;
}

export interface OboTokenResult {
  accessToken: string;
  expiresOn: Date;
  scopes: string[];
  account?: AccountInfo | null;
}

export interface CachedOboTokenRequest {
  userId: string;
  scopes: string[];
  correlationId: string;
  homeAccountId?: string;
  localAccountId?: string;
}

// ---------------------------------------------------------------------------
// MSAL client cache (one per userId for cache isolation)
// ---------------------------------------------------------------------------

const clientCache = new Map<string, ConfidentialClientApplication>();

function getMsalClient(userId: string): ConfidentialClientApplication {
  let client = clientCache.get(userId);
  if (client) return client;

  const env = getEnvConfig();

  // The OBO app registration is the DelegatedAuth Entra app, NOT the UAMI bot identity.
  // It has Graph delegated permissions + client secret stored in Key Vault.
  const delegatedClientId = env.entraDelegatedAuthClientId;
  if (!delegatedClientId) {
    throw new Error('ENTRA_DELEGATED_AUTH_CLIENT_ID not configured — OBO flow unavailable');
  }

  const config: Configuration = {
    auth: {
      clientId: delegatedClientId,
      authority: `https://login.microsoftonline.com/${env.microsoftAppTenantId}`,
      // Use client secret for OBO auth (retrieved from KV via env var)
      clientSecret: env.entraOboClientSecret,
    },
    cache: {
      cachePlugin: createCosmosCachePlugin(userId),
    },
  };

  client = new ConfidentialClientApplication(config);
  clientCache.set(userId, client);
  return client;
}

// ---------------------------------------------------------------------------
// OBO token exchange
// ---------------------------------------------------------------------------

/**
 * Exchange a Teams SSO token for a delegated Graph token via OBO flow.
 * Returns a short-lived access token scoped to the requested Graph permissions.
 *
 * Throws if:
 * - The user hasn't consented (triggers need for /link flow, #31)
 * - The SSO token is invalid or expired
 * - The requested scopes aren't granted
 */
export async function acquireTokenOnBehalfOf(
  request: OboTokenRequest,
): Promise<OboTokenResult> {
  const client = getMsalClient(request.userId);

  const result: AuthenticationResult | null = await client.acquireTokenOnBehalfOf({
    oboAssertion: request.assertion,
    scopes: request.scopes.map((s) =>
      s.startsWith('https://') ? s : `https://graph.microsoft.com/${s}`,
    ),
    correlationId: request.correlationId,
  });

  if (!result) {
    throw new OboError(
      'OBO token exchange returned null — user may need to re-consent via /link',
      'no_result',
    );
  }

  return {
    accessToken: result.accessToken,
    expiresOn: result.expiresOn ?? new Date(Date.now() + 300_000),
    scopes: result.scopes,
    account: result.account,
  };
}

/**
 * Acquire a delegated downstream token silently from the persisted MSAL cache.
 * Requires an OBO bootstrap to have already seeded the cache for this user/session.
 */
export async function acquireCachedTokenForUser(
  request: CachedOboTokenRequest,
): Promise<OboTokenResult> {
  const client = getMsalClient(request.userId);
  const tokenCache = client.getTokenCache();

  const account = await resolveAccount(tokenCache, request);
  if (!account) {
    throw new OboError(
      `No cached OBO account found for user ${request.userId}`,
      'no_cached_account',
    );
  }

  const result = await client.acquireTokenSilent({
    account,
    scopes: request.scopes.map((s) => s.startsWith('https://') ? s : `https://graph.microsoft.com/${s}`),
    correlationId: request.correlationId,
  });

  if (!result) {
    throw new OboError(
      `Silent OBO acquisition returned null for user ${request.userId}`,
      'no_result',
    );
  }

  return {
    accessToken: result.accessToken,
    expiresOn: result.expiresOn ?? new Date(Date.now() + 300_000),
    scopes: result.scopes,
    account: result.account,
  };
}

async function resolveAccount(
  tokenCache: Pick<ReturnType<ConfidentialClientApplication['getTokenCache']>, 'getAccountByHomeId' | 'getAccountByLocalId' | 'getAllAccounts'>,
  request: CachedOboTokenRequest,
): Promise<AccountInfo | null> {
  if (request.homeAccountId) {
    const byHomeId = await tokenCache.getAccountByHomeId(request.homeAccountId);
    if (byHomeId) return byHomeId;
  }

  if (request.localAccountId) {
    const byLocalId = await tokenCache.getAccountByLocalId(request.localAccountId);
    if (byLocalId) return byLocalId;
  }

  const allAccounts = await tokenCache.getAllAccounts();
  return allAccounts[0] ?? null;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class OboError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'OboError';
  }
}
