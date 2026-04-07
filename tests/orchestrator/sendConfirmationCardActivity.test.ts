import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadModule(options?: { duplicate?: boolean }) {
  vi.resetModules();

  const continueConversationAsync = vi.fn(async (_appId, _conversationReference, callback) => {
    const updateActivity = vi.fn(async () => undefined);
    const sendActivity = vi.fn(async () => ({ id: 'card-1' }));
    await callback({ sendActivity, updateActivity });
    return { sendActivity, updateActivity };
  });

  const claimOutboundArtifact = vi.fn(async () => !options?.duplicate);
  const releaseOutboundArtifactClaim = vi.fn(async () => undefined);
  const getPendingAckId = vi.fn(async () => 'ack-1');
  const clearPendingAckId = vi.fn(async () => undefined);
  const recordOrchestratorStage = vi.fn(async () => undefined);

  vi.doMock('../../src/bot/conversationStore.js', () => ({
    getConversationReference: vi.fn(async () => ({ conversation: { id: 'conv-1' } })),
    claimOutboundArtifact,
    getPendingAckId,
    clearPendingAckId,
    releaseOutboundArtifactClaim,
  }));

  vi.doMock('../../src/config/envConfig.js', () => ({
    getEnvConfig: () => ({
      microsoftAppId: 'test-app-id',
      microsoftAppTenantId: 'test-tenant-id',
    }),
  }));

  vi.doMock('../../src/observability/orchestratorStageHealth.js', () => ({
    recordOrchestratorStage,
  }));

  vi.doMock('../../src/bot/confirmationCards.js', () => ({
    buildConfirmationCard: vi.fn(() => ({ contentType: 'application/vnd.microsoft.card.adaptive' })),
  }));

  vi.doMock('botbuilder', () => ({
    ActivityTypes: { Message: 'message' },
    CloudAdapter: class {
      continueConversationAsync = continueConversationAsync;
    },
    ConfigurationBotFrameworkAuthentication: class {},
  }));

  const mod = await import('../../src/orchestrator/sendConfirmationCardActivity.js');
  return {
    ...mod,
    clearPendingAckId,
    claimOutboundArtifact,
    continueConversationAsync,
    getPendingAckId,
    releaseOutboundArtifactClaim,
    recordOrchestratorStage,
  };
}

describe('sendConfirmationCardActivity', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../src/bot/conversationStore.js');
    vi.doUnmock('../../src/config/envConfig.js');
    vi.doUnmock('../../src/observability/orchestratorStageHealth.js');
    vi.doUnmock('../../src/bot/confirmationCards.js');
    vi.doUnmock('botbuilder');
  });

  it('records awaiting-confirmation stage after sending a confirmation card', async () => {
    const {
      sendConfirmationCard,
      clearPendingAckId,
      getPendingAckId,
      recordOrchestratorStage,
      continueConversationAsync,
    } = await loadModule();

    const result = await sendConfirmationCard({
      userId: 'user-1',
      toolName: 'outlook_create_calendar_event',
      risk: 'high',
      description: 'Execute 1 tool(s): outlook_create_calendar_event',
      correlationId: 'corr-123',
      sessionInstanceId: 'session-123',
    });

    expect(result).toEqual({ sent: true, ackResolved: true });
    expect(continueConversationAsync).toHaveBeenCalledOnce();
    expect(getPendingAckId).toHaveBeenCalledWith('corr-123');
    expect(clearPendingAckId).toHaveBeenCalledWith('conv-1', 'corr-123');
    expect(recordOrchestratorStage).toHaveBeenCalledWith(
      'corr-123',
      'awaiting-confirmation',
      'user-1',
    );
  });

  it('reasserts awaiting-confirmation stage when duplicate confirmation is suppressed', async () => {
    const {
      sendConfirmationCard,
      continueConversationAsync,
      recordOrchestratorStage,
    } = await loadModule({ duplicate: true });

    const result = await sendConfirmationCard({
      userId: 'user-1',
      toolName: 'outlook_create_calendar_event',
      risk: 'high',
      description: 'Execute 1 tool(s): outlook_create_calendar_event',
      correlationId: 'corr-duplicate',
      sessionInstanceId: 'session-123',
    });

    expect(result.sent).toBe(true);
    expect(result.skippedDuplicate).toBe(true);
    expect(continueConversationAsync).not.toHaveBeenCalled();
    expect(recordOrchestratorStage).toHaveBeenCalledWith(
      'corr-duplicate',
      'awaiting-confirmation',
      'user-1',
    );
  });
});
