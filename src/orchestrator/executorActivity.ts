// Executor activity — executes high-risk destructive actions with zero LLM involvement.
// Never called directly by the LLM; always handed a cryptographically signed payload
// from the verification pipeline after human confirmation.
// Spec ref: 04-Safety-Architecture.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getHandler } from '../capabilities/capabilityLoader.js';
import { ScopedTokenMinter } from '../auth/scopedTokenMinter.js';
import { trackEvent } from '../observability/telemetry.js';

// ---------------------------------------------------------------------------
// Signing key — derived from env; falls back to a per-instance random key.
// In production, use a Key Vault–sourced secret.
// ---------------------------------------------------------------------------
const EXECUTOR_HMAC_KEY = process.env.EXECUTOR_HMAC_KEY ?? 'helkinswarm-executor-default-key';

export interface ExecutorInput {
  action: 'delete' | 'move' | 'create' | 'admin';
  toolName: string;
  /** HMAC-SHA256 signature over the payload (sessionId + arguments hash) */
  signedPayload: string;
  /** Hash of the original read output that was spot-checked */
  payloadHash: string;
  correlationId: string;
  sessionId: string;
  userId: string;
  targetResource: string;
  /** Raw arguments passed to the tool */
  arguments: Record<string, unknown>;
}

export interface ExecutorResult {
  success: boolean;
  action: string;
  toolName: string;
  result?: unknown;
  error?: string;
  correlationId: string;
  executedAt: string;
}

// ---------------------------------------------------------------------------
// Cryptographic signing/verification
// ---------------------------------------------------------------------------

/** Create an HMAC-SHA256 signature for an executor payload. */
export function signExecutorPayload(
  sessionId: string,
  toolName: string,
  payloadHash: string,
): string {
  const data = `${sessionId}:${toolName}:${payloadHash}`;
  return createHmac('sha256', EXECUTOR_HMAC_KEY).update(data).digest('hex');
}

/** Verify an HMAC-SHA256 signature matches the expected payload. */
function verifySignature(
  signedPayload: string,
  sessionId: string,
  toolName: string,
  payloadHash: string,
): boolean {
  const expected = signExecutorPayload(sessionId, toolName, payloadHash);
  // Constant-time comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(signedPayload, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

/** Create a hash of the tool arguments for integrity verification. */
export function hashPayload(args: Record<string, unknown>): string {
  const serialized = JSON.stringify(args, Object.keys(args).sort());
  return createHmac('sha256', EXECUTOR_HMAC_KEY).update(serialized).digest('hex');
}

// ---------------------------------------------------------------------------
// Durable activity
// ---------------------------------------------------------------------------

df.app.activity('executorActivity', {
  handler: async (input: ExecutorInput): Promise<ExecutorResult> => {
    const executedAt = new Date().toISOString();

    // 1. Verify cryptographic signature — rejects tampered payloads
    if (!verifySignature(input.signedPayload, input.sessionId, input.toolName, input.payloadHash)) {
      trackEvent({
        name: 'ToolExecuted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          toolName: input.toolName,
          action: input.action,
          executor: true,
          success: false,
          error: 'signature_verification_failed',
        },
      });
      return {
        success: false,
        action: input.action,
        toolName: input.toolName,
        error: 'Signature verification failed — payload may have been tampered with',
        correlationId: input.correlationId,
        executedAt,
      };
    }

    // 2. Verify payload hash matches the arguments (ensures read output wasn't altered)
    const expectedHash = hashPayload(input.arguments);
    if (expectedHash !== input.payloadHash) {
      trackEvent({
        name: 'ToolExecuted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          toolName: input.toolName,
          action: input.action,
          executor: true,
          success: false,
          error: 'payload_hash_mismatch',
        },
      });
      return {
        success: false,
        action: input.action,
        toolName: input.toolName,
        error: 'Payload hash mismatch — arguments were modified after verification',
        correlationId: input.correlationId,
        executedAt,
      };
    }

    // 3. Mint a scoped token restricted to the action scope
    const minter = new ScopedTokenMinter();
    const scopedToken = await minter.mint({
      toolName: input.toolName,
      scope: input.action === 'delete' ? 'delete' : 'write',
      targetResource: input.targetResource,
      userId: input.userId,
      correlationId: input.correlationId,
    });

    // 4. Execute via the registered handler (no LLM involvement)
    const handler = getHandler(input.toolName);
    if (!handler) {
      trackEvent({
        name: 'ToolExecuted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          toolName: input.toolName,
          action: input.action,
          executor: true,
          success: false,
          error: 'no_handler',
        },
      });
      return {
        success: false,
        action: input.action,
        toolName: input.toolName,
        error: `No handler registered for tool: ${input.toolName}`,
        correlationId: input.correlationId,
        executedAt,
      };
    }

    try {
      // Inject userId and scoped token into arguments for the handler
      const enrichedArgs = {
        ...input.arguments,
        userId: input.userId,
        _scopedToken: scopedToken.token,
        _scopedTokenScope: scopedToken.scope,
      };
      const result = await handler(enrichedArgs);

      trackEvent({
        name: 'ToolExecuted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          toolName: input.toolName,
          action: input.action,
          executor: true,
          success: true,
          tokenScope: scopedToken.scope,
        },
      });

      // Revoke the scoped token (best-effort)
      minter.revoke(scopedToken).catch(() => { /* non-fatal */ });

      return {
        success: true,
        action: input.action,
        toolName: input.toolName,
        result,
        correlationId: input.correlationId,
        executedAt,
      };
    } catch (err) {
      trackEvent({
        name: 'ToolExecuted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          toolName: input.toolName,
          action: input.action,
          executor: true,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });

      // Revoke the scoped token even on failure
      minter.revoke(scopedToken).catch(() => { /* non-fatal */ });

      return {
        success: false,
        action: input.action,
        toolName: input.toolName,
        error: err instanceof Error ? err.message : String(err),
        correlationId: input.correlationId,
        executedAt,
      };
    }
  },
});
