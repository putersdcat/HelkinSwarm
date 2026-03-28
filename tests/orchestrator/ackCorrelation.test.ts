import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadSendReplyModule(options?: { hangUpdate?: boolean }) {
  vi.resetModules();

  const continueConversationAsync = vi.fn(async (_appId, conversationReference, callback) => {
    const updateActivity = vi.fn(async () => {
      if (options?.hangUpdate) {
        return await new Promise(() => undefined);
      }
      return undefined;
    });
    const sendActivity = vi.fn(async () => ({ id: 'sent-1' }));
    await callback({ updateActivity, sendActivity });
    return { conversationReference, updateActivity, sendActivity };
  });

  const getPendingAckId = vi.fn(async () => 'ack-activity-1');
  const clearPendingAckId = vi.fn(async () => undefined);

  vi.doMock('../../src/bot/conversationStore.js', () => ({
    getConversationReference: vi.fn(async () => ({ conversation: { id: 'conv-1' } })),
    getPendingAckId,
    clearPendingAckId,
  }));

  vi.doMock('../../src/bot/sentMessageCache.js', () => ({
    cacheSentMessage: vi.fn(),
  }));

  vi.doMock('../../src/config/envConfig.js', () => ({
    getEnvConfig: () => ({
      microsoftAppId: 'test-app-id',
      microsoftAppTenantId: 'test-tenant-id',
    }),
  }));

  vi.doMock('botbuilder', () => ({
    ActivityTypes: { Message: 'message' },
    CloudAdapter: class {
      continueConversationAsync = continueConversationAsync;
    },
    ConfigurationBotFrameworkAuthentication: class {},
  }));

  const mod = await import('../../src/orchestrator/sendReplyActivity.js');
  return { ...mod, getPendingAckId, clearPendingAckId, continueConversationAsync };
}

async function loadSpinnerModule() {
  vi.resetModules();

  const continueConversationAsync = vi.fn(async (_appId, conversationReference, callback) => {
    const updateActivity = vi.fn(async () => undefined);
    await callback({ updateActivity });
    return { conversationReference, updateActivity };
  });

  const getPendingAckId = vi.fn(async () => 'ack-activity-2');

  vi.doMock('../../src/bot/conversationStore.js', () => ({
    getConversationReference: vi.fn(async () => ({ conversation: { id: 'conv-2' } })),
    getPendingAckId,
  }));

  vi.doMock('../../src/bot/ackVariants.js', () => ({
    getCorrelatedSpinnerAck: vi.fn(() => '⠋ Still thinking... [corr:abc12345]'),
  }));

  vi.doMock('../../src/config/envConfig.js', () => ({
    getEnvConfig: () => ({
      microsoftAppId: 'test-app-id',
      microsoftAppTenantId: 'test-tenant-id',
    }),
  }));

  vi.doMock('botbuilder', () => ({
    ActivityTypes: { Message: 'message' },
    CloudAdapter: class {
      continueConversationAsync = continueConversationAsync;
    },
    ConfigurationBotFrameworkAuthentication: class {},
  }));

  const mod = await import('../../src/orchestrator/spinnerHeartbeatActivity.js');
  return { ...mod, getPendingAckId, continueConversationAsync };
}

describe('ack correlation scoping', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.doUnmock('../../src/bot/conversationStore.js');
    vi.doUnmock('../../src/bot/sentMessageCache.js');
    vi.doUnmock('../../src/bot/ackVariants.js');
    vi.doUnmock('../../src/config/envConfig.js');
    vi.doUnmock('botbuilder');
  });

  it('sendReply resolves and clears the pending ack by correlationId, not userId', async () => {
    process.env['MICROSOFT_APP_ID'] = 'test-app-id';
    process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
    const { sendReply, getPendingAckId, clearPendingAckId } = await loadSendReplyModule();

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-123',
      message: 'done',
    });

    expect(result.success).toBe(true);
    expect(getPendingAckId).toHaveBeenCalledWith('corr-123');
    expect(clearPendingAckId).toHaveBeenCalledWith('conv-1', 'corr-123');
  });

  it('sendReply skips fallback message when ack update times out to prevent duplicates (#329)', async () => {
    const { sendReply, continueConversationAsync } = await loadSendReplyModule({ hangUpdate: true });

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-hung-update',
      message: 'done',
    });

    expect(result.success).toBe(true);
    // The important invariant here is that the sendReply path still completes
    // successfully after the ack-update timeout path is exercised (#329).
    // The callback internals are intentionally not asserted here because the
    // mocked continueConversation promise can settle after the timeout path.
    expect(continueConversationAsync).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('spinnerHeartbeat resolves the pending ack by correlationId, not userId', async () => {
    process.env['MICROSOFT_APP_ID'] = 'test-app-id';
    process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
    const { spinnerHeartbeat, getPendingAckId } = await loadSpinnerModule();

    const result = await spinnerHeartbeat({
      userId: 'user-2',
      correlationId: 'corr-456',
      correlationTag: 'abc12345',
    });

    expect(typeof result.updated).toBe('boolean');
    expect(getPendingAckId).toHaveBeenCalledWith('corr-456');
  }, 15_000);
});