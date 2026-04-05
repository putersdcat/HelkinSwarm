import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  continueConversationAsync: vi.fn(),
  getConversationReference: vi.fn(),
  getStaleAcks: vi.fn(),
  clearPendingAckId: vi.fn(),
  clearOrchestratorStage: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('../../src/bot/conversationStore.js', () => ({
  getConversationReference: harness.getConversationReference,
  getStaleAcks: harness.getStaleAcks,
  clearPendingAckId: harness.clearPendingAckId,
}));

vi.mock('../../src/observability/orchestratorStageHealth.js', () => ({
  clearOrchestratorStage: harness.clearOrchestratorStage,
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
  harness.clearOrchestratorStage.mockReset();
  harness.trackEvent.mockReset();

  harness.clearPendingAckId.mockResolvedValue(undefined);
  harness.clearOrchestratorStage.mockResolvedValue(undefined);
  harness.getStaleAcks.mockResolvedValue([]);
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
  });

  it('clears the matching orchestrator stage when no conversation reference exists', async () => {
    const { recoverStaleAck } = await loadModule();
    harness.getConversationReference.mockResolvedValue(null);

    const outcome = await recoverStaleAck(
      'conv-2',
      'ack-2',
      'user-2',
      'corr-2',
    );

    expect(outcome).toBe('cleared-without-reference');
    expect(harness.clearPendingAckId).toHaveBeenCalledWith('conv-2', 'corr-2');
    expect(harness.clearOrchestratorStage).toHaveBeenCalledWith('corr-2', 'user-2');
    expect(harness.continueConversationAsync).not.toHaveBeenCalled();
  });

  it('clears the matching orchestrator stage even when stale-ack recovery fails', async () => {
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

    expect(stats).toEqual({ recovered: 0, clearedWithoutReference: 0, failed: 1 });
    expect(harness.clearPendingAckId).toHaveBeenCalledWith('conv-3', 'corr-3');
    expect(harness.clearOrchestratorStage).toHaveBeenCalledWith('corr-3', 'user-3');
  });
});