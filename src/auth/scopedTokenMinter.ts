// Scoped token minter — issues minimum-privilege delegated tokens with 5-minute TTL.
// Spec ref: 04-Safety-Architecture.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import { z } from 'zod';
import { isReadOnly } from '../config/safetyConfig.js';

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
}

export interface ScopedToken {
  token: string;
  expiresAt: string;
  scope: ScopedTokenScope;
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

    // In production: call Entra ID with OBO flow, request only the needed scope
    // For now: generate a signed placeholder
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000).toISOString();
    const token = this.generatePlaceholderToken(request, effectiveScope, expiresAt);

    return {
      token,
      expiresAt,
      scope: effectiveScope,
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
