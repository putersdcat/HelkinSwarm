import * as df from 'durable-functions';
import { z } from 'zod';
import { getPendingAckId, hasOutboundArtifactClaim } from '../bot/conversationStore.js';

export const ReplyDeliveryRecoveryInputSchema = z.object({
  conversationId: z.string().min(1),
  correlationId: z.string().min(1),
  userId: z.string().min(1),
});

export const ReplyDeliveryRecoveryResultSchema = z.object({
  replyClaimExists: z.boolean(),
  pendingAckPresent: z.boolean(),
  recovered: z.boolean(),
});

export type ReplyDeliveryRecoveryInput = z.infer<typeof ReplyDeliveryRecoveryInputSchema>;
export type ReplyDeliveryRecoveryResult = z.infer<typeof ReplyDeliveryRecoveryResultSchema>;

export async function detectReplyDeliveryRecovery(
  rawInput: ReplyDeliveryRecoveryInput,
): Promise<ReplyDeliveryRecoveryResult> {
  const input = ReplyDeliveryRecoveryInputSchema.parse(rawInput);
  const replyClaimExists = await hasOutboundArtifactClaim(input.conversationId, 'reply', input.correlationId);
  const pendingAckPresent = (await getPendingAckId(input.correlationId)) !== null;

  return ReplyDeliveryRecoveryResultSchema.parse({
    replyClaimExists,
    pendingAckPresent,
    recovered: replyClaimExists && !pendingAckPresent,
  });
}

df.app.activity('replyDeliveryRecoveryActivity', {
  handler: async (rawInput: unknown): Promise<ReplyDeliveryRecoveryResult> => {
    return await detectReplyDeliveryRecovery(rawInput as ReplyDeliveryRecoveryInput);
  },
});