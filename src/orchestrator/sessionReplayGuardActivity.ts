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

  const effectiveSessionExecutionClaim = existingSessionExecutionClaim
    ?? await getOutboundArtifactClaim(
      input.conversationId,
      'session-execution',
      input.correlationId,
    );

  return effectiveSessionExecutionClaim?.ownerInstanceId !== input.sessionInstanceId;
}

df.app.activity('sessionReplayGuardActivity', {
  handler: async (rawInput: unknown): Promise<boolean> => {
    return await detectDuplicateSessionReplay(rawInput as SessionReplayGuardInput);
  },
});