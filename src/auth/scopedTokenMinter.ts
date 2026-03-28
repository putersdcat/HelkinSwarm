// Scoped token minter — issues minimum-privilege delegated tokens with 5-minute TTL.
// Spec ref: 04-Safety-Architecture.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import { z } from 'zod';
import { isReadOnly } from '../config/safetyConfig.js';
import { acquireCachedTokenForUser, acquireTokenOnBehalfOf } from './oboTokenProvider.js';
import { loadOboSession } from './oboSessionStore.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const ScopedTokenScope = z.enum([
  'read',
  'write',
  'delete',
  'admin',
]);
export type ScopedTokenScope = z.infer<typeof ScopedTokenScope>;

export interface ScopedTokenRequest {
  toolName: string;
  scope: ScopedTokenScope;
  targetResource: string;
  userId: string;
  correlationId: string;
  /** SSO assertion from Teams — enables real OBO token minting */
  assertion?: string;
  /** Graph scopes to request (overrides domain defaults) */
  graphScopes?: string[];
}

/** Default Graph scopes per-skill domain — least-privilege per spec §11 */
const DOMAIN_GRAPH_SCOPES: Record<string, string[]> = {
  outlook: ['Mail.Read', 'Mail.Send', 'Calendars.Read', 'Calendars.ReadWrite'],
  github: [], // Uses App installation tokens, not Graph OBO
  core: [],   // Uses UAMI, not user-delegated tokens
};

export interface ScopedToken {
  token: string;
  expiresAt: string;
  scope: ScopedTokenScope;
  method: 'obo' | 'placeholder';
  targetResource: string;
  toolName: string;
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Token minter
// ---------------------------------------------------------------------------

export class ScopedTokenMinter {
  private readonly ttlSeconds = 300; // 5 minutes

  /**
   * Mint a scoped token for a tool call.
   * In read-only mode, only 'read' tokens are ever issued.
   * In production: calls Entra ID OBO flow with minimum-permission app role.
   */
  async mint(request: ScopedTokenRequest): Promise<ScopedToken> {
    // Enforce read-only mode at the architecture level
    if (isReadOnly() && request.scope !== 'read') {
      throw new ScopedTokenError(
        `read-only mode: refusing to mint ${request.scope} token for ${request.toolName}`,
        'read-only',
      );
    }

    const effectiveScope = this.effectiveScope(request.scope);

    // Determine Graph scopes from domain or explicit override
    const domain = request.targetResource || 'core';
    const graphScopes = request.graphScopes ?? DOMAIN_GRAPH_SCOPES[domain] ?? [];

    // If SSO assertion available and Graph scopes needed, use real OBO (#28)
    if (request.assertion && graphScopes.length > 0) {
      const oboResult = await acquireTokenOnBehalfOf({
        userId: request.userId,
        assertion: request.assertion,
        scopes: graphScopes,
        correlationId: request.correlationId,
      });

      trackEvent({ name: 'ScopedTokenMinted', correlationId: request.correlationId, properties: {
        toolName: request.toolName,
        domain,
        scope: effectiveScope,
        method: 'obo',
        acquisition: 'assertion',
        scopeCount: String(graphScopes.length),
      } });

      return {
        token: oboResult.accessToken,
        expiresAt: oboResult.expiresOn.toISOString(),
        scope: effectiveScope,
        method: 'obo',
        targetResource: request.targetResource,
        toolName: request.toolName,
        correlationId: request.correlationId,
      };
    }

    // Silent OBO from the persisted MSAL cache after Teams token-exchange bootstrap (#330)
    if (graphScopes.length > 0) {
      const session = await loadOboSession(request.userId);
      if (session) {
        try {
          const oboResult = await acquireCachedTokenForUser({
            userId: request.userId,
            scopes: graphScopes,
            correlationId: request.correlationId,
            homeAccountId: session.homeAccountId,
            localAccountId: session.localAccountId,
          });

          trackEvent({ name: 'ScopedTokenMinted', correlationId: request.correlationId, properties: {
            toolName: request.toolName,
            domain,
            scope: effectiveScope,
            method: 'obo',
            acquisition: 'silent',
            scopeCount: String(graphScopes.length),
          } });

          return {
            token: oboResult.accessToken,
            expiresAt: oboResult.expiresOn.toISOString(),
            scope: effectiveScope,
            method: 'obo',
            targetResource: request.targetResource,
            toolName: request.toolName,
            correlationId: request.correlationId,
          };
        } catch (err) {
          trackEvent({
            name: 'HandlerTokenSource',
            correlationId: request.correlationId,
            userId: request.userId,
            properties: {
              handler: request.toolName,
              source: 'obo-cache-miss',
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    }

    // Fallback: placeholder token (for tools that don't need Graph/OBO)
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString();
    const token = this.generatePlaceholderToken(request, effectiveScope, expiresAt);

    trackEvent({ name: 'ScopedTokenMinted', correlationId: request.correlationId, properties: {
      toolName: request.toolName,
      domain,
      scope: effectiveScope,
      method: 'placeholder',
      acquisition: 'fallback',
    } });

    return {
      token,
      expiresAt,
      scope: effectiveScope,
      method: 'placeholder',
      targetResource: request.targetResource,
      toolName: request.toolName,
      correlationId: request.correlationId,
    };
  }

  /**
   * Downgrade scope to read-only if safety mode requires it.
   */
  private effectiveScope(requested: ScopedTokenScope): ScopedTokenScope {
    if (isReadOnly()) return 'read';
    return requested;
  }

  /**
   * Generate a signed placeholder token.
   * TODO (Phase 3+): Replace with real Entra ID OBO token + HMAC signature.
   */
  private generatePlaceholderToken(
    request: ScopedTokenRequest,
    scope: ScopedTokenScope,
    expiresAt: string,
  ): string {
    const payload = {
      sub: request.userId,
      scope: scope,
      resource: request.targetResource,
      tool: request.toolName,
      corr: request.correlationId,
      exp: expiresAt,
      iat: new Date().toISOString(),
    };
    // Placeholder: in production this is a real JWT from Entra ID OBO flow
    return `placeholder_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  }

  /**
   * Revoke a token (fire-and-forget in production).
   */
  async revoke(_token: ScopedToken): Promise<void> {
    // In production: call Entra ID token revocation endpoint with the token's jti claim.
    // For placeholder tokens, this is a no-op.
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ScopedTokenError extends Error {
  constructor(message: string, public readonly reason: 'read-only' | 'insufficient-scope' | 'token-expired') {
    super(message);
    this.name = 'ScopedTokenError';
  }
}

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

export const scopedTokenMinter = new ScopedTokenMinter();

/** Whether a scoped token is a local placeholder envelope rather than a real provider token. */
export function isPlaceholderScopedToken(token: string | undefined): boolean {
  return typeof token === 'string' && token.startsWith('placeholder_');
}
