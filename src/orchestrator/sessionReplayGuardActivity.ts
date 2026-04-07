import * as df from 'durable-functions';
import { z } from 'zod';
import { claimOutboundArtifact, getOutboundArtifactClaim, hasOutboundArtifactClaim } from '../bot/conversationStore.js';
import { getOrchestratorStageForCorrelation } from '../observability/orchestratorStageHealth.js';

const SessionReplayGuardInputSchema = z.object({
  conversationId: z.string().min(1),
  correlationId: z.string().min(1),
  userId: z.string().min(1),
  sessionInstanceId: z.string().min(1),
});

export type SessionReplayGuardInput = z.infer<typeof SessionReplayGuardInputSchema>;

const SAME_OWNER_ACTIVE_STAGE_WINDOW_MS = 45_000;

function shouldSuppressSameOwnerReentryForActiveStage(
  stage: { stage: string; startedAtMs: number; updatedAtMs: number },
  nowMs: number,
): boolean {
  if (stage.stage === 'awaiting-ingress' || stage.stage === 'cleared') {
    return false;
  }

  const freshnessAnchor = Math.max(stage.startedAtMs, stage.updatedAtMs);
  return nowMs - freshnessAnchor <= SAME_OWNER_ACTIVE_STAGE_WINDOW_MS;
}

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

  if (!effectiveSessionExecutionClaim) {
    return false;
  }

  if (effectiveSessionExecutionClaim.ownerInstanceId !== input.sessionInstanceId) {
    return true;
  }

  const stageForCorrelation = await getOrchestratorStageForCorrelation(
    input.correlationId,
    input.userId,
  );

  if (!stageForCorrelation) {
    return false;
  }

  return shouldSuppressSameOwnerReentryForActiveStage(stageForCorrelation, Date.now());
}

df.app.activity('sessionReplayGuardActivity', {
  handler: async (rawInput: unknown): Promise<boolean> => {
    return await detectDuplicateSessionReplay(rawInput as SessionReplayGuardInput);
  },
});