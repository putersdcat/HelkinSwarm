import { trackEvent } from '../observability/telemetry.js';
import { acquireTokenOnBehalfOf } from './oboTokenProvider.js';
import { saveOboSession, type OboSessionRecord } from './oboSessionStore.js';

const OBO_BOOTSTRAP_SCOPES = ['User.Read'];

export interface OboBootstrapInput {
  userId: string;
  assertion: string;
  correlationId: string;
}

export interface OboBootstrapResult {
  session: OboSessionRecord;
  scopes: string[];
  expiresOn: string;
}

/**
 * Seed the persisted MSAL cache and store a stable account hint for later silent OBO acquisition.
 */
export async function bootstrapOboSession(
  input: OboBootstrapInput,
): Promise<OboBootstrapResult> {
  const result = await acquireTokenOnBehalfOf({
    userId: input.userId,
    assertion: input.assertion,
    scopes: OBO_BOOTSTRAP_SCOPES,
    correlationId: input.correlationId,
  });

  const session = await saveOboSession(input.userId, {
    homeAccountId: result.account?.homeAccountId,
    localAccountId: result.account?.localAccountId,
    username: result.account?.username,
    tenantId: result.account?.tenantId,
    bootstrappedAt: new Date().toISOString(),
    lastCorrelationId: input.correlationId,
    source: 'teams-token-exchange',
  });

  trackEvent({
    name: 'OboSessionBootstrapped',
    correlationId: input.correlationId,
    userId: input.userId,
    properties: {
      scopes: result.scopes.join(' '),
      hasHomeAccountId: String(!!session.homeAccountId),
      hasLocalAccountId: String(!!session.localAccountId),
      source: session.source,
    },
  });

  return {
    session,
    scopes: result.scopes,
    expiresOn: result.expiresOn.toISOString(),
  };
}