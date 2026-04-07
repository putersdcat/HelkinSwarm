import * as df from 'durable-functions';
import { z } from 'zod';
import { claimOutboundArtifact, getOutboundArtifactClaim, hasOutboundArtifactClaim } from '../bot/conversationStore.js';

const SessionReplayGuardInputSchema = z.object({
  conversationId: z.string().min(1),
  correlationId: z.string().min(1),
  userId: z.string().min(1),
  sessionInstanceId: z.string().min(1),
});

export type SessionReplayGuardInput = z.infer<typeof SessionReplayGuardInputSchema>;

export async function detectDuplicateSessionReplay(rawInput: SessionReplayGuardInput): Promise<boolean> {
  const input = SessionReplayGuardInputSchema.parse(rawInput);

  if (await hasOutboundArtifactClaim(input.conversationId, 'reply', input.correlationId)) {
    return true;
  }

  const existingSessionExecutionClaim = await getOutboundArtifactClaim(
    input.conversationId,
    'session-execution',
    input.correlationId,
  );

  if (!existingSessionExecutionClaim) {
    const claimedSessionExecution = await claimOutboundArtifact(
      input.conversationId,
      input.userId,
      'session-execution',
      input.correlationId,
      input.sessionInstanceId,
    );

    if (claimedSessionExecution) {
      return false;
    }
  }

  // #587: if execution for this same correlation is already claimed, any fresh
  // run that reaches this activity is a duplicate pre-reply execution attempt.
  // Legitimate Durable replay should use recorded history and should not invoke
  // this activity again. So we suppress even when the stored ownerInstanceId
  // matches the current sessionInstanceId.
  const effectiveSessionExecutionClaim = existingSessionExecutionClaim
    ?? await getOutboundArtifactClaim(
      input.conversationId,
      'session-execution',
      input.correlationId,
    );

  return effectiveSessionExecutionClaim !== undefined;
}

df.app.activity('sessionReplayGuardActivity', {
  handler: async (rawInput: unknown): Promise<boolean> => {
    return await detectDuplicateSessionReplay(rawInput as SessionReplayGuardInput);
  },
});