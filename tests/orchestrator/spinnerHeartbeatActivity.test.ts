import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  continueConversationAsync: vi.fn(),
  getConversationReference: vi.fn(),
  getPendingAckId: vi.fn(),
  hasOutboundArtifactClaim: vi.fn(),
}));

vi.mock('../../src/bot/conversationStore.js', () => ({
  getConversationReference: harness.getConversationReference,
  getPendingAckId: harness.getPendingAckId,
  hasOutboundArtifactClaim: harness.hasOutboundArtifactClaim,
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
  harness.getPendingAckId.mockReset();
  harness.hasOutboundArtifactClaim.mockReset();

  harness.getPendingAckId.mockResolvedValue('ack-1');
  harness.getConversationReference.mockResolvedValue({ conversation: { id: 'conv-1' } });
  harness.hasOutboundArtifactClaim.mockResolvedValue(false);
  harness.continueConversationAsync.mockImplementation(async (_appId, _conversationReference, callback) => {
    const updateActivity = vi.fn(async () => undefined);
    await callback({ updateActivity });
    return { updateActivity };
  });

  return await import('../../src/orchestrator/spinnerHeartbeatActivity.js');
}

describe('spinnerHeartbeatActivity', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips spinner updates once a reply claim already exists for the correlation', async () => {
    const { spinnerHeartbeat } = await loadModule();
    harness.hasOutboundArtifactClaim.mockResolvedValue(true);

    const result = await spinnerHeartbeat({
      userId: 'user-1',
      correlationId: 'corr-1',
      correlationTag: 'corr-1',
    });

    expect(result).toEqual({ updated: false });
    expect(harness.continueConversationAsync).not.toHaveBeenCalled();
  });

  it('updates the ack when no reply claim exists yet', async () => {
    const { spinnerHeartbeat } = await loadModule();

    const result = await spinnerHeartbeat({
      userId: 'user-1',
      correlationId: 'corr-1',
      correlationTag: 'corr-1',
    });

    expect(result).toEqual({ updated: true });
    expect(harness.continueConversationAsync).toHaveBeenCalledTimes(1);
  });
});