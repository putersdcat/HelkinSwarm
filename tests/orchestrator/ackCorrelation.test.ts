import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  continueConversationAsync: vi.fn(),
  getConversationReference: vi.fn(),
  getPendingAckId: vi.fn(),
  clearPendingAckId: vi.fn(),
  claimOutboundArtifact: vi.fn(),
  releaseOutboundArtifactClaim: vi.fn(),
  cacheSentMessage: vi.fn(),
  readRuntimeAssetContent: vi.fn(),
  loadRuntimeAssetReference: vi.fn(),
  recordSubstage: vi.fn(),
  getCorrelatedSpinnerAck: vi.fn(),
}));

vi.mock('../../src/bot/conversationStore.js', () => ({
  getConversationReference: harness.getConversationReference,
  getPendingAckId: harness.getPendingAckId,
  clearPendingAckId: harness.clearPendingAckId,
  claimOutboundArtifact: harness.claimOutboundArtifact,
  releaseOutboundArtifactClaim: harness.releaseOutboundArtifactClaim,
}));

vi.mock('../../src/bot/sentMessageCache.js', () => ({
  cacheSentMessage: harness.cacheSentMessage,
}));

vi.mock('../../src/bot/ackVariants.js', () => ({
  getCorrelatedSpinnerAck: harness.getCorrelatedSpinnerAck,
}));

vi.mock('../../src/integrations/runtimeAssetStore.js', () => ({
  readRuntimeAssetContent: harness.readRuntimeAssetContent,
  loadRuntimeAssetReference: harness.loadRuntimeAssetReference,
}));

vi.mock('../../src/config/envConfig.js', () => ({
  getEnvConfig: () => ({
    microsoftAppId: 'test-app-id',
    microsoftAppTenantId: 'test-tenant-id',
  }),
}));

vi.mock('../../src/observability/orchestratorStageHealth.js', () => ({
  recordSubstage: harness.recordSubstage,
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

function configureCommonHarness(): void {
  harness.getConversationReference.mockResolvedValue({ conversation: { id: 'conv-1' } });
  harness.getPendingAckId.mockResolvedValue('ack-activity-1');
  harness.clearPendingAckId.mockResolvedValue(undefined);
  harness.claimOutboundArtifact.mockResolvedValue(true);
  harness.releaseOutboundArtifactClaim.mockResolvedValue(undefined);
  harness.cacheSentMessage.mockImplementation(() => undefined);
  harness.readRuntimeAssetContent.mockResolvedValue(null);
  harness.loadRuntimeAssetReference.mockResolvedValue(null);
  harness.recordSubstage.mockImplementation(() => undefined);
  harness.getCorrelatedSpinnerAck.mockReturnValue('⠋ Still thinking... [corr:abc12345]');
}

async function loadSendReplyModule(options?: { hangUpdate?: boolean; hangAckClear?: boolean; fastPath?: boolean }) {
  vi.resetModules();
  vi.clearAllMocks();
  configureCommonHarness();

  if (options?.fastPath) {
    process.env['SENDREPLY_FAST_PATH'] = '1';
  } else {
    delete process.env['SENDREPLY_FAST_PATH'];
  }

  harness.continueConversationAsync.mockImplementation(async (_appId, conversationReference, callback) => {
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

  const mod = await import('../../src/orchestrator/sendReplyActivity.js');
  if (options?.hangAckClear) {
    harness.clearPendingAckId.mockImplementation(async () => await new Promise(() => undefined));
  }
  return {
    ...mod,
    getPendingAckId: harness.getPendingAckId,
    clearPendingAckId: harness.clearPendingAckId,
    claimOutboundArtifact: harness.claimOutboundArtifact,
    releaseOutboundArtifactClaim: harness.releaseOutboundArtifactClaim,
    continueConversationAsync: harness.continueConversationAsync,
    recordSubstage: harness.recordSubstage,
  };
}

async function loadSpinnerModule() {
  vi.resetModules();
  vi.clearAllMocks();
  configureCommonHarness();

  harness.getConversationReference.mockResolvedValue({ conversation: { id: 'conv-2' } });
  harness.getPendingAckId.mockResolvedValue('ack-activity-2');
  harness.continueConversationAsync.mockImplementation(async (_appId, conversationReference, callback) => {
    const updateActivity = vi.fn(async () => undefined);
    await callback({ updateActivity });
    return { conversationReference, updateActivity };
  });

  const mod = await import('../../src/orchestrator/spinnerHeartbeatActivity.js');
  return {
    ...mod,
    getPendingAckId: harness.getPendingAckId,
    continueConversationAsync: harness.continueConversationAsync,
  };
}

describe('ack correlation scoping', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.resetModules();
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
    const { sendReply, claimOutboundArtifact, continueConversationAsync, recordSubstage } = await loadSendReplyModule();
    claimOutboundArtifact.mockResolvedValue(false);

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-duplicate',
      message: 'done',
    });

    expect(result.success).toBe(true);
    expect(claimOutboundArtifact).toHaveBeenCalledWith('conv-1', 'user-1', 'reply', 'corr-duplicate');
    expect(continueConversationAsync).not.toHaveBeenCalled();
    expect(recordSubstage).toHaveBeenCalledWith('corr-duplicate', 'send-reply', 'user-1');
  });

  it('sendReply skips pending-ack lookup and claim logic when SENDREPLY_FAST_PATH is enabled', async () => {
    const { sendReply, getPendingAckId, claimOutboundArtifact, clearPendingAckId, recordSubstage } = await loadSendReplyModule({ fastPath: true });

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-fast-path',
      message: 'done',
    });

    expect(result.success).toBe(true);
    expect(claimOutboundArtifact).not.toHaveBeenCalled();
    expect(getPendingAckId).not.toHaveBeenCalled();
    expect(clearPendingAckId).not.toHaveBeenCalled();
    expect(recordSubstage).toHaveBeenCalledWith('corr-fast-path', 'send-reply', 'user-1');
  });

  it('sendReply does not hang the reply path when pending-ack cleanup stalls after a successful send', async () => {
    const { sendReply, clearPendingAckId } = await loadSendReplyModule({ hangAckClear: true });

    const result = await sendReply({
      userId: 'user-1',
      correlationId: 'corr-hung-clear',
      message: 'done',
    });

    expect(result.success).toBe(true);
    expect(clearPendingAckId).toHaveBeenCalledWith('conv-1', 'corr-hung-clear');
  });
});