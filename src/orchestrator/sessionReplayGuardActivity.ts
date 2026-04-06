import * as df from 'durable-functions';
import { z } from 'zod';
import { claimOutboundArtifact, hasOutboundArtifactClaim } from '../bot/conversationStore.js';

const SessionReplayGuardInputSchema = z.object({
  conversationId: z.string().min(1),
  correlationId: z.string().min(1),
  userId: z.string().min(1),
});

export type SessionReplayGuardInput = z.infer<typeof SessionReplayGuardInputSchema>;

export async function detectDuplicateSessionReplay(rawInput: SessionReplayGuardInput): Promise<boolean> {
  const input = SessionReplayGuardInputSchema.parse(rawInput);

  if (await hasOutboundArtifactClaim(input.conversationId, 'reply', input.correlationId)) {
    return true;
  }

  const claimedSessionExecution = await claimOutboundArtifact(
    input.conversationId,
    input.userId,
    'session-execution',
    input.correlationId,
  );

  return !claimedSessionExecution;
}

df.app.activity('sessionReplayGuardActivity', {
  handler: async (rawInput: unknown): Promise<boolean> => {
    return await detectDuplicateSessionReplay(rawInput as SessionReplayGuardInput);
  },
});