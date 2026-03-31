import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAttachmentReplyModule() {
  vi.resetModules();

  let lastUpdateActivity: ReturnType<typeof vi.fn> | undefined;
  let lastSendActivity: ReturnType<typeof vi.fn> | undefined;

  const continueConversationAsync = vi.fn(async (_appId, conversationReference, callback) => {
    const updateActivity = vi.fn(async () => undefined);
    const sendActivity = vi.fn(async () => ({ id: 'sent-attachment' }));
    lastUpdateActivity = updateActivity;
    lastSendActivity = sendActivity;
    await callback({ updateActivity, sendActivity });
    return { conversationReference, updateActivity, sendActivity };
  });

  vi.doMock('../../src/bot/conversationStore.js', () => ({
    getConversationReference: vi.fn(async () => ({ conversation: { id: 'conv-1' } })),
    getPendingAckId: vi.fn(async () => 'ack-activity-1'),
    clearPendingAckId: vi.fn(async () => undefined),
    claimOutboundArtifact: vi.fn(async () => true),
    releaseOutboundArtifactClaim: vi.fn(async () => undefined),
  }));

  vi.doMock('../../src/bot/sentMessageCache.js', () => ({
    cacheSentMessage: vi.fn(),
  }));

  const loadRuntimeAssetReference = vi.fn(async ({ assetId }: { assetId: string }) => {
    if (assetId === '11111111-1111-4111-8111-111111111111') {
      return {
        id: assetId,
        userId: 'user-1',
        correlationId: 'corr-assets',
        contentType: 'image/png',
        fileName: 'asset-image.png',
        byteLength: 4,
        summary: 'image summary',
      };
    }

    if (assetId === '22222222-2222-4222-8222-222222222222') {
      return {
        id: assetId,
        userId: 'user-1',
        correlationId: 'corr-assets',
        contentType: 'text/plain',
        fileName: 'asset-file.txt',
        byteLength: 10,
        summary: 'file summary',
      };
    }

    return null;
  });

  const readRuntimeAssetContent = vi.fn(async ({ assetId }: { assetId: string }) => {
    if (assetId === '11111111-1111-4111-8111-111111111111') {
      return {
        reference: {
          id: assetId,
          userId: 'user-1',
          correlationId: 'corr-assets',
          contentType: 'image/png',
          fileName: 'asset-image.png',
        },
        content: Buffer.from([137, 80, 78, 71]),
      };
    }

    return null;
  });

  vi.doMock('../../src/integrations/runtimeAssetStore.js', () => ({
    loadRuntimeAssetReference,
    readRuntimeAssetContent,
  }));

  vi.doMock('../../src/config/envConfig.js', () => ({
    getEnvConfig: () => ({
      microsoftAppId: 'test-app-id',
      microsoftAppTenantId: 'test-tenant-id',
    }),
  }));

  vi.doMock('../../src/observability/orchestratorStageHealth.js', () => ({
    clearOrchestratorStage: vi.fn(async () => undefined),
    recordSubstage: vi.fn(() => undefined),
  }));

  vi.doMock('botbuilder', () => ({
    ActivityTypes: { Message: 'message' },
    CloudAdapter: class {
      continueConversationAsync = continueConversationAsync;
    },
    ConfigurationBotFrameworkAuthentication: class {
      constructor(_config?: unknown) {}
    },
  }));

  const mod = await import('../../src/orchestrator/sendReplyActivity.js');
  return {
    ...mod,
    loadRuntimeAssetReference,
    readRuntimeAssetContent,
    getLastSendActivity: () => lastSendActivity,
    getLastUpdateActivity: () => lastUpdateActivity,
  };
}

describe('sendReply attachment support', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../src/bot/conversationStore.js');
    vi.doUnmock('../../src/bot/sentMessageCache.js');
    vi.doUnmock('../../src/integrations/runtimeAssetStore.js');
    vi.doUnmock('../../src/config/envConfig.js');
    vi.doUnmock('../../src/observability/orchestratorStageHealth.js');
    vi.doUnmock('botbuilder');
  });

  it('emits inline image attachments and file-consent cards from runtime asset references', async () => {
    const {
      sendReply,
      loadRuntimeAssetReference,
      readRuntimeAssetContent,
      getLastSendActivity,
      getLastUpdateActivity,
    } = await loadAttachmentReplyModule();

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-assets',
      message: 'asset reply',
      assets: [
        { assetId: '11111111-1111-4111-8111-111111111111' },
        { assetId: '22222222-2222-4222-8222-222222222222' },
      ],
    });

    expect(result.success).toBe(true);
    expect(loadRuntimeAssetReference).toHaveBeenCalledTimes(2);
    expect(readRuntimeAssetContent).toHaveBeenCalledTimes(1);

    const updateActivity = getLastUpdateActivity();
    const sendActivity = getLastSendActivity();
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
          contentType: 'application/vnd.microsoft.teams.card.file.consent',
          name: 'asset-file.txt',
          content: expect.objectContaining({
            sizeInBytes: 10,
            acceptContext: expect.objectContaining({
              assetId: '22222222-2222-4222-8222-222222222222',
              userId: 'user-1',
            }),
          }),
        }),
      ],
    }));
  });
});