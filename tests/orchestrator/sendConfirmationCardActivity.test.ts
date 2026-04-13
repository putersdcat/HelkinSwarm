import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — reliable across vitest workers & ESM module caching
// ---------------------------------------------------------------------------
const mockContinueConversationAsync = vi.fn();
const mockClaimOutboundArtifact = vi.fn();
const mockReleaseOutboundArtifactClaim = vi.fn();
const mockGetPendingAckId = vi.fn();
const mockClearPendingAckId = vi.fn();
const mockRecordOrchestratorStage = vi.fn();
const mockGetConversationReference = vi.fn();
const mockBuildConfirmationCard = vi.fn();

vi.mock('../../src/bot/conversationStore.js', () => ({
  getConversationReference: mockGetConversationReference,
  claimOutboundArtifact: mockClaimOutboundArtifact,
  getPendingAckId: mockGetPendingAckId,
  clearPendingAckId: mockClearPendingAckId,
  releaseOutboundArtifactClaim: mockReleaseOutboundArtifactClaim,
}));

vi.mock('../../src/config/envConfig.js', () => ({
  getEnvConfig: () => ({
    microsoftAppId: 'test-app-id',
    microsoftAppTenantId: 'test-tenant-id',
  }),
}));

vi.mock('../../src/observability/orchestratorStageHealth.js', () => ({
  recordOrchestratorStage: mockRecordOrchestratorStage,
}));

vi.mock('../../src/bot/confirmationCards.js', () => ({
  buildConfirmationCard: mockBuildConfirmationCard,
}));

vi.mock('botbuilder', () => ({
  ActivityTypes: { Message: 'message' },
  CloudAdapter: class {
    continueConversationAsync = mockContinueConversationAsync;
  },
  ConfigurationBotFrameworkAuthentication: class {},
}));

describe('sendConfirmationCardActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations (non-duplicate path)
    mockGetConversationReference.mockResolvedValue({ conversation: { id: 'conv-1' } });
    mockClaimOutboundArtifact.mockResolvedValue(true);
    mockReleaseOutboundArtifactClaim.mockResolvedValue(undefined);
    mockGetPendingAckId.mockResolvedValue('ack-1');
    mockClearPendingAckId.mockResolvedValue(undefined);
    mockRecordOrchestratorStage.mockResolvedValue(undefined);
    mockBuildConfirmationCard.mockReturnValue({ contentType: 'application/vnd.microsoft.card.adaptive' });
    mockContinueConversationAsync.mockImplementation(async (_appId, _conversationReference, callback) => {
      const updateActivity = vi.fn(async () => undefined);
      const sendActivity = vi.fn(async () => ({ id: 'card-1' }));
      await callback({ sendActivity, updateActivity });
      return { sendActivity, updateActivity };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('records awaiting-confirmation stage after sending a confirmation card', async () => {
    const { sendConfirmationCard } = await import('../../src/orchestrator/sendConfirmationCardActivity.js');

    const result = await sendConfirmationCard({
      userId: 'user-1',
      toolName: 'outlook_create_calendar_event',
      risk: 'high',
      description: 'Execute 1 tool(s): outlook_create_calendar_event',
      correlationId: 'corr-123',
      sessionInstanceId: 'session-123',
    });

    expect(result).toEqual({ sent: true, ackResolved: true });
    expect(mockContinueConversationAsync).toHaveBeenCalledOnce();
    expect(mockGetPendingAckId).toHaveBeenCalledWith('corr-123');
    expect(mockClearPendingAckId).toHaveBeenCalledWith('conv-1', 'corr-123');
    expect(mockRecordOrchestratorStage).toHaveBeenCalledWith(
      'corr-123',
      'awaiting-confirmation',
      'user-1',
    );
  });

  it('reasserts awaiting-confirmation stage when duplicate confirmation is suppressed', async () => {
    // Override: claimOutboundArtifact returns false → duplicate path
    mockClaimOutboundArtifact.mockResolvedValue(false);

    const { sendConfirmationCard } = await import('../../src/orchestrator/sendConfirmationCardActivity.js');

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
    expect(mockContinueConversationAsync).not.toHaveBeenCalled();
    expect(mockRecordOrchestratorStage).toHaveBeenCalledWith(
      'corr-duplicate',
      'awaiting-confirmation',
      'user-1',
    );
  });
});
