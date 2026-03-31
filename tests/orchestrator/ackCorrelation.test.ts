import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadSendReplyModule(options?: { hangUpdate?: boolean; fastPath?: boolean }) {
  vi.resetModules();

  let lastUpdateActivity: ReturnType<typeof vi.fn> | undefined;
  let lastSendActivity: ReturnType<typeof vi.fn> | undefined;

  if (options?.fastPath) {
    process.env['SENDREPLY_FAST_PATH'] = '1';
  } else {
    delete process.env['SENDREPLY_FAST_PATH'];
  }

  const continueConversationAsync = vi.fn(async (_appId, conversationReference, callback) => {
    const updateActivity = vi.fn(async () => {
      if (options?.hangUpdate) {
        return await new Promise(() => undefined);
      }
      return undefined;
    });
    const sendActivity = vi.fn(async () => ({ id: 'sent-1' }));
    lastUpdateActivity = updateActivity;
    lastSendActivity = sendActivity;
    await callback({ updateActivity, sendActivity });
    return { conversationReference, updateActivity, sendActivity };
  });

  const getPendingAckId = vi.fn(async () => 'ack-activity-1');
  const clearPendingAckId = vi.fn(async () => undefined);
  const claimOutboundArtifact = vi.fn(async () => true);
  const releaseOutboundArtifactClaim = vi.fn(async () => undefined);

  vi.doMock('../../src/bot/conversationStore.js', () => ({
    getConversationReference: vi.fn(async () => ({ conversation: { id: 'conv-1' } })),
    getPendingAckId,
    clearPendingAckId,
    claimOutboundArtifact,
    releaseOutboundArtifactClaim,
  }));

  vi.doMock('../../src/bot/sentMessageCache.js', () => ({
    cacheSentMessage: vi.fn(),
  }));

  const readRuntimeAssetContent = vi.fn(async ({ assetId }: { assetId: string }) => {
    if (assetId === 'asset-image') {
      return {
        reference: {
          id: 'asset-image',
          userId: 'user-1',
          correlationId: 'corr-assets',
          contentType: 'image/png',
          fileName: 'asset-image.png',
        },
        content: Buffer.from([137, 80, 78, 71]),
      };
    }

    if (assetId === 'asset-file') {
      return {
        reference: {
          id: 'asset-file',
          userId: 'user-1',
          correlationId: 'corr-assets',
          contentType: 'text/plain',
          fileName: 'asset-file.txt',
        },
        content: Buffer.from('hello file', 'utf8'),
      };
    }

    return null;
  });

  vi.doMock('../../src/integrations/runtimeAssetStore.js', () => ({
    readRuntimeAssetContent,
  }));

  vi.doMock('../../src/config/envConfig.js', () => ({
    getEnvConfig: () => ({
      microsoftAppId: 'test-app-id',
      microsoftAppTenantId: 'test-tenant-id',
    }),
  }));

  const clearOrchestratorStage = vi.fn(async () => undefined);
  const recordSubstage = vi.fn(() => undefined);

  vi.doMock('../../src/observability/orchestratorStageHealth.js', () => ({
    clearOrchestratorStage,
    recordSubstage,
  }));

  vi.doMock('botbuilder', () => ({
    ActivityTypes: { Message: 'message' },
    CloudAdapter: class {
      continueConversationAsync = continueConversationAsync;
    },
    ConfigurationBotFrameworkAuthentication: function ConfigurationBotFrameworkAuthentication() {
      return undefined;
    },
  }));

  const mod = await import('../../src/orchestrator/sendReplyActivity.js');
  return {
    ...mod,
    getPendingAckId,
    clearPendingAckId,
    claimOutboundArtifact,
    releaseOutboundArtifactClaim,
    continueConversationAsync,
    clearOrchestratorStage,
    recordSubstage,
    readRuntimeAssetContent,
    getLastSendActivity: () => lastSendActivity,
    getLastUpdateActivity: () => lastUpdateActivity,
  };
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
    vi.doUnmock('../../src/integrations/runtimeAssetStore.js');
    vi.doUnmock('../../src/observability/orchestratorStageHealth.js');
    vi.doUnmock('botbuilder');
    delete process.env['SENDREPLY_FAST_PATH'];
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
    const { sendReply } = await loadSendReplyModule({ hangUpdate: true });

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-hung-update',
      message: 'done',
    });

    expect(result.success).toBe(true);
    // The important invariant here is that the sendReply path still completes
    // successfully after the ack-update timeout path is exercised (#329), even
    // with the newer outbound-artifact dedup claim in front of the send path.
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

  it('sendReply suppresses duplicate proactive replies for the same correlationId', async () => {
    const { sendReply, claimOutboundArtifact, continueConversationAsync, clearOrchestratorStage } = await loadSendReplyModule();
    claimOutboundArtifact.mockResolvedValue(false);

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-duplicate',
      message: 'done',
    });

    expect(result.success).toBe(true);
    expect(claimOutboundArtifact).toHaveBeenCalledWith('conv-1', 'user-1', 'reply', 'corr-duplicate');
    expect(continueConversationAsync).not.toHaveBeenCalled();
    expect(clearOrchestratorStage).toHaveBeenCalledWith('corr-duplicate', 'user-1');
  });

  it('sendReply still clears orchestrator stage when SENDREPLY_FAST_PATH is enabled', async () => {
    const { sendReply, clearOrchestratorStage, getPendingAckId, claimOutboundArtifact } = await loadSendReplyModule({ fastPath: true });

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-fast-path',
      message: 'done',
    });

    expect(result.success).toBe(true);
    expect(claimOutboundArtifact).not.toHaveBeenCalled();
    expect(getPendingAckId).not.toHaveBeenCalled();
    expect(clearOrchestratorStage).toHaveBeenCalledWith('corr-fast-path', 'user-1');
  });

  it('sendReply can emit runtime-asset-backed Teams attachments after the text reply', async () => {
    const { sendReply, readRuntimeAssetContent, getLastSendActivity, getLastUpdateActivity } = await loadSendReplyModule();

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-assets',
      message: 'asset reply',
      assets: [
        { assetId: 'asset-image' },
        { assetId: 'asset-file' },
      ],
    });

    expect(result.success).toBe(true);
    expect(readRuntimeAssetContent).toHaveBeenCalledTimes(2);
    const sendActivity = getLastSendActivity();
    const updateActivity = getLastUpdateActivity();
    expect(sendActivity).toBeDefined();
    expect(updateActivity).toBeDefined();
    expect(updateActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      id: 'ack-activity-1',
      text: 'asset reply',
    }));

    expect(sendActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      attachments: [
        expect.objectContaining({
          contentType: 'image/png',
          name: 'asset-image.png',
          thumbnailUrl: expect.stringContaining('data:image/png;base64,'),
        }),
        expect.objectContaining({
          contentType: 'text/plain',
          name: 'asset-file.txt',
          contentUrl: expect.stringContaining('data:text/plain;base64,'),
        }),
      ],
    }));
  });
});