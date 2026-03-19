// Executor activity — executes high-risk actions with zero LLM involvement.
// Never called directly; always handed a cryptographically signed, spot-checked payload.
// Spec ref: 04-Safety-Architecture.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import * as df from 'durable-functions';

export interface ExecutorInput {
  action: 'delete' | 'move' | 'create' | 'admin';
  toolName: string;
  /** Signed payload: sessionId + hash of the original spot-checked read output */
  signedPayload: string;
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
  affectedCount: number;
  error?: string;
  correlationId: string;
  executedAt: string;
}

df.app.activity('executorActivity', {
  handler: async (input: ExecutorInput): Promise<ExecutorResult> => {
    // -------------------------------------------------------------------------
    // Signature verification (Phase 3 stub — replace with real HMAC check)
    // -------------------------------------------------------------------------
    const signatureValid = verifySignature(input.signedPayload, input.sessionId);
    if (!signatureValid) {
      return {
        success: false,
        action: input.action,
        affectedCount: 0,
        error: 'Signature verification failed — payload may have been tampered with',
        correlationId: input.correlationId,
        executedAt: new Date().toISOString(),
      };
    }

    // -------------------------------------------------------------------------
    // Action execution (Phase 3 stubs — wire to real handlers in Phase 4+)
    // -------------------------------------------------------------------------
    try {
      switch (input.action) {
        case 'delete':
          return executeDelete(input);
        case 'move':
          return executeMove(input);
        case 'create':
          return executeCreate(input);
        case 'admin':
          return executeAdmin(input);
        default:
          return {
            success: false,
            action: input.action,
            affectedCount: 0,
            error: `Unknown action: ${input.action}`,
            correlationId: input.correlationId,
            executedAt: new Date().toISOString(),
          };
      }
    } catch (err) {
      return {
        success: false,
        action: input.action,
        affectedCount: 0,
        error: err instanceof Error ? err.message : String(err),
        correlationId: input.correlationId,
        executedAt: new Date().toISOString(),
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Signature verification stub
// ---------------------------------------------------------------------------

function verifySignature(signedPayload: string, _sessionId: string): boolean {
  // Phase 3 stub: verify the HMAC signature of the signed payload.
  // Real implementation: HMAC-SHA256(sessionId, payload) == provided signature
  // For now, always pass (placeholder tokens are base64url-encoded JSON)
  return signedPayload.startsWith('placeholder_') || signedPayload.startsWith('sig_');
}

// ---------------------------------------------------------------------------
// Action handlers (Phase 3 stubs)
// ---------------------------------------------------------------------------

function executeDelete(input: ExecutorInput): ExecutorResult {
  // Phase 4: wire to real Graph API / storage delete handlers
  return {
    success: true,
    action: 'delete',
    affectedCount: 0,
    correlationId: input.correlationId,
    executedAt: new Date().toISOString(),
  };
}

function executeMove(input: ExecutorInput): ExecutorResult {
  // Phase 4: wire to real move handlers
  return {
    success: true,
    action: 'move',
    affectedCount: 0,
    correlationId: input.correlationId,
    executedAt: new Date().toISOString(),
  };
}

function executeCreate(input: ExecutorInput): ExecutorResult {
  // Phase 4: wire to real create handlers
  return {
    success: true,
    action: 'create',
    affectedCount: 0,
    correlationId: input.correlationId,
    executedAt: new Date().toISOString(),
  };
}

function executeAdmin(input: ExecutorInput): ExecutorResult {
  // Phase 4: wire to real admin action handlers
  return {
    success: true,
    action: 'admin',
    affectedCount: 0,
    correlationId: input.correlationId,
    executedAt: new Date().toISOString(),
  };
}
