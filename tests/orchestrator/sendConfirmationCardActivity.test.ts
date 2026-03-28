import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfirmationModule() {
  vi.resetModules();

  const claimOutboundArtifact = vi.fn(async () => true);
  const releaseOutboundArtifactClaim = vi.fn(async () => undefined);
  const continueConversationAsync = vi.fn(async (_appId, _conversationReference, callback) => {
    const sendActivity = vi.fn(async () => ({ id: 'card-1' }));
    await callback({ sendActivity });
  });

  vi.doMock('../../src/bot/conversationStore.js', () => ({
    getConversationReference: vi.fn(async () => ({ conversation: { id: 'conv-card-1' } })),
    claimOutboundArtifact,
    releaseOutboundArtifactClaim,
  }));

  vi.doMock('../../src/bot/confirmationCards.js', () => ({
    buildConfirmationCard: vi.fn(() => ({ contentType: 'application/vnd.microsoft.card.adaptive', content: {} })),
  }));

  vi.doMock('../../src/config/envConfig.js', () => ({
    getEnvConfig: () => ({
      microsoftAppId: 'test-app-id',
      microsoftAppTenantId: 'test-tenant-id',
    }),
  }));

  vi.doMock('botbuilder', () => ({
    CloudAdapter: class {
      continueConversationAsync = continueConversationAsync;
    },
    ConfigurationBotFrameworkAuthentication: class {},
  }));

  const mod = await import('../../src/orchestrator/sendConfirmationCardActivity.js');
  return { ...mod, claimOutboundArtifact, releaseOutboundArtifactClaim, continueConversationAsync };
}

describe('sendConfirmationCard', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../src/bot/conversationStore.js');
    vi.doUnmock('../../src/bot/confirmationCards.js');
    vi.doUnmock('../../src/config/envConfig.js');
    vi.doUnmock('botbuilder');
  });

  it('suppresses duplicate confirmation cards for the same session instance', async () => {
    const { sendConfirmationCard, claimOutboundArtifact, continueConversationAsync } = await loadConfirmationModule();
    claimOutboundArtifact.mockResolvedValue(false);

    const result = await sendConfirmationCard({
      userId: 'user-1',
      toolName: 'outlook_send_email',
      risk: 'high',
      description: 'send email',
      correlationId: 'corr-1',
      sessionInstanceId: 'session-1',
    });

    expect(result).toEqual({ sent: true, skippedDuplicate: true });
    expect(claimOutboundArtifact).toHaveBeenCalledWith('conv-card-1', 'user-1', 'confirmation-card', 'session-1');
    expect(continueConversationAsync).not.toHaveBeenCalled();
  });
});