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
import type { AuthenticationResult, Configuration } from '@azure/msal-node';
import { createCosmosCachePlugin } from './msalCachePlugin.js';
import { getEnvConfig } from '../config/envConfig.js';
import { getBearerToken } from './identity.js';

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
}

// ---------------------------------------------------------------------------
// MSAL client cache (one per userId for cache isolation)
// ---------------------------------------------------------------------------

const clientCache = new Map<string, ConfidentialClientApplication>();

function getMsalClient(userId: string): ConfidentialClientApplication {
  let client = clientCache.get(userId);
  if (client) return client;

  const env = getEnvConfig();

  // The OBO app registration must have:
  // - A client credential (certificate or federated via UAMI — no client secrets)
  // - API permissions for Microsoft Graph with admin consent
  const config: Configuration = {
    auth: {
      clientId: env.microsoftAppId,
      authority: `https://login.microsoftonline.com/${env.microsoftAppTenantId}`,
      // Use client assertion callback for certificate-based auth via UAMI
      // This avoids storing any client secret — the UAMI can fetch the cert from KV.
      clientAssertion: async () => {
        // Mint a client assertion using the UAMI's managed identity credential
        // against the AAD token endpoint. This is the zero-secrets pattern.
        return getBearerToken('api://AzureADTokenExchange/.default');
      },
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
  };
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
