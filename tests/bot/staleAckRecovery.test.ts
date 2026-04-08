import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  continueConversationAsync: vi.fn(),
  getConversationReference: vi.fn(),
  getStaleAcks: vi.fn(),
  clearPendingAckId: vi.fn(),
  hasOutboundArtifactClaim: vi.fn(),
  clearOrchestratorStage: vi.fn(),
  getOrchestratorStageForCorrelation: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('../../src/bot/conversationStore.js', () => ({
  getConversationReference: harness.getConversationReference,
  getStaleAcks: harness.getStaleAcks,
  clearPendingAckId: harness.clearPendingAckId,
  hasOutboundArtifactClaim: harness.hasOutboundArtifactClaim,
}));

vi.mock('../../src/observability/orchestratorStageHealth.js', () => ({
  clearOrchestratorStage: harness.clearOrchestratorStage,
  getOrchestratorStageForCorrelation: harness.getOrchestratorStageForCorrelation,
}));

vi.mock('../../src/observability/telemetry.js', () => ({
  trackEvent: harness.trackEvent,
}));

vi.mock('../../src/config/envConfig.js', () => ({
  getEnvConfig: () => ({
    microsoftAppId: 'test-app-id',
    microsoftAppTenantId: 'test-tenant-id',
  }),
}));

vi.mock('botbuilder', () => ({
  ActivityTypes: { Message: 'message' },
  CloudAdapter: class {
    continueConversationAsync = harness.continueConversationAsync;
  },
  ConfigurationBotFrameworkAuthentication: class {
    constructor(_config?: unknown) {}
  },
}));

async function loadModule() {
  vi.resetModules();
  harness.continueConversationAsync.mockReset();
  harness.getConversationReference.mockReset();
  harness.getStaleAcks.mockReset();
  harness.clearPendingAckId.mockReset();
  harness.hasOutboundArtifactClaim.mockReset();
  harness.clearOrchestratorStage.mockReset();
  harness.getOrchestratorStageForCorrelation.mockReset();
  harness.trackEvent.mockReset();

  harness.clearPendingAckId.mockResolvedValue(undefined);
  harness.clearOrchestratorStage.mockResolvedValue(undefined);
  harness.getStaleAcks.mockResolvedValue([]);
  harness.hasOutboundArtifactClaim.mockResolvedValue(false);
  harness.getOrchestratorStageForCorrelation.mockResolvedValue(undefined);
  harness.continueConversationAsync.mockImplementation(async (_appId, conversationReference, callback) => {
    const updateActivity = vi.fn(async () => undefined);
    await callback({ updateActivity });
    return { conversationReference, updateActivity };
  });

  return await import('../../src/bot/staleAckRecovery.js');
}

describe('staleAckRecovery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clears the matching orchestrator stage when a stale ack is recovered with a conversation reference', async () => {
    const { recoverStaleAck } = await loadModule();

    const outcome = await recoverStaleAck(
      'conv-1',
      'ack-1',
      'user-1',
      'corr-1',
      { conversation: { id: 'conv-1' } },
    );

    expect(outcome).toBe('recovered');
    expect(harness.clearPendingAckId).toHaveBeenCalledWith('conv-1', 'corr-1');
    expect(harness.clearOrchestratorStage).toHaveBeenCalledWith('corr-1', 'user-1');
    const callback = harness.continueConversationAsync.mock.calls[0]?.[2];
    const updateActivity = vi.fn(async () => undefined);
    await callback?.({ updateActivity });
    expect(updateActivity).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('[corr:corr-1]'.replace('corr-1', 'corr-1'.slice(0, 8))),
    }));
  });

  it('skips recovery when the turn still has an active stage', async () => {
    const { recoverStaleAck } = await loadModule();
    harness.getOrchestratorStageForCorrelation.mockResolvedValue({
      correlationId: 'corr-2',
      userId: 'user-2',
      stage: 'llm',
      startedAtMs: 1,
      updatedAtMs: 2,
    });

    const outcome = await recoverStaleAck(
      'conv-2',
      'ack-2',
      'user-2',
      'corr-2',
    );

    expect(outcome).toBe('skipped');
    expect(harness.continueConversationAsync).not.toHaveBeenCalled();
    expect(harness.clearPendingAckId).not.toHaveBeenCalled();
    expect(harness.clearOrchestratorStage).not.toHaveBeenCalled();
  });

  it('skips recovery when a reply claim already exists', async () => {
    const { recoverStaleAck } = await loadModule();
    harness.hasOutboundArtifactClaim.mockResolvedValue(true);

    const outcome = await recoverStaleAck(
      'conv-claim',
      'ack-claim',
      'user-claim',
      'corr-claim',
      { conversation: { id: 'conv-claim' } },
    );

    expect(outcome).toBe('skipped');
    expect(harness.continueConversationAsync).not.toHaveBeenCalled();
    expect(harness.clearPendingAckId).not.toHaveBeenCalled();
    expect(harness.clearOrchestratorStage).not.toHaveBeenCalled();
  });

  it('does not clear ack or stage when stale-ack recovery itself fails', async () => {
    const { recoverStaleAcks } = await loadModule();
    harness.getStaleAcks.mockResolvedValue([
      {
        conversationId: 'conv-3',
        activityId: 'ack-3',
        userId: 'user-3',
        correlationId: 'corr-3',
        createdAt: new Date().toISOString(),
      },
    ]);
    harness.getConversationReference.mockResolvedValue({ conversation: { id: 'conv-3' } });
    harness.continueConversationAsync.mockRejectedValue(new Error('adapter exploded'));

    const stats = await recoverStaleAcks();

    expect(stats).toEqual({ recovered: 0, skipped: 0, failed: 1 });
    expect(harness.clearPendingAckId).not.toHaveBeenCalled();
    expect(harness.clearOrchestratorStage).not.toHaveBeenCalled();
  });
});