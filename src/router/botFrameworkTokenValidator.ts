// Bot Framework JWT validator for the router.
// Validates that incoming activities come from the real Bot Framework Service.
// This is defense-in-depth — the stamp also validates via CloudAdapter, but
// the router should reject unauthenticated requests before forwarding.
//
// Spec ref: docs/11-Authentication-Identity.md
// Issue: #213 — enforce auth on all web-deployed components

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getEnvConfig } from '../config/envConfig.js';

// Primary Bot Framework channel token signing keys
const BF_JWKS = createRemoteJWKSet(
  new URL('https://login.botframework.com/v1/.well-known/keys'),
);

// OAuth 2.0 issuers the Bot Framework Service may use
const ACCEPTED_ISSUERS = new Set([
  'https://api.botframework.com',
  'https://login.microsoftonline.com/botframework.com/v2.0',
  // BF tenant STS (MSA tokens from Teams channel)
  'https://sts.windows.net/d6d49420-f39b-4df7-a1dc-d59a935871db/',
]);

/**
 * Validates the incoming Bot Framework Bearer token.
 * Throws with a descriptive message if the token is missing or invalid.
 * Returns silently if valid.
 *
 * @param authorizationHeader - Raw value of the Authorization header (may be null)
 */
export async function validateBotFrameworkToken(
  authorizationHeader: string | null,
): Promise<void> {
  if (!authorizationHeader) {
    throw new Error('Missing Authorization header');
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) {
    throw new Error('Authorization header is not a Bearer token');
  }

  const token = match[1];
  const env = getEnvConfig();
  const botAppId = env.microsoftAppId;

  if (!botAppId) {
    throw new Error('MICROSOFT_APP_ID is not configured');
  }

  const { payload } = await jwtVerify(token, BF_JWKS, {
    audience: botAppId,
    clockTolerance: 300, // 5 minute tolerance for clock skew
  });

  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  if (!ACCEPTED_ISSUERS.has(iss)) {
    throw new Error(`Unexpected token issuer: ${iss}`);
  }
}
