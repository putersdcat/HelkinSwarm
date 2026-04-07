import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasOutboundArtifactClaimMock = vi.fn();
const getOutboundArtifactClaimMock = vi.fn();
const claimOutboundArtifactMock = vi.fn();
const getOrchestratorStageForCorrelationMock = vi.fn();

vi.mock('../../src/bot/conversationStore.js', () => ({
  hasOutboundArtifactClaim: hasOutboundArtifactClaimMock,
  getOutboundArtifactClaim: getOutboundArtifactClaimMock,
  claimOutboundArtifact: claimOutboundArtifactMock,
}));

vi.mock('../../src/observability/orchestratorStageHealth.js', () => ({
  getOrchestratorStageForCorrelation: getOrchestratorStageForCorrelationMock,
}));

describe('detectDuplicateSessionReplay', () => {
  beforeEach(() => {
    hasOutboundArtifactClaimMock.mockReset();
    getOutboundArtifactClaimMock.mockReset();
    claimOutboundArtifactMock.mockReset();
    getOrchestratorStageForCorrelationMock.mockReset();
  });

  it('returns false when a new session-execution claim is acquired', async () => {
    hasOutboundArtifactClaimMock.mockResolvedValue(false);
    getOutboundArtifactClaimMock.mockResolvedValue(null);
    claimOutboundArtifactMock.mockResolvedValue(true);

    const { detectDuplicateSessionReplay } = await import('../../src/orchestrator/sessionReplayGuardActivity.js');

    const duplicate = await detectDuplicateSessionReplay({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      userId: 'user-1',
      sessionInstanceId: 'session-1',
    });

    expect(duplicate).toBe(false);
  });

  it('suppresses when an existing session-execution claim belongs to another instance', async () => {
    hasOutboundArtifactClaimMock.mockResolvedValue(false);
    getOutboundArtifactClaimMock.mockResolvedValue({ ownerInstanceId: 'session-other' });

    const { detectDuplicateSessionReplay } = await import('../../src/orchestrator/sessionReplayGuardActivity.js');

    const duplicate = await detectDuplicateSessionReplay({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      userId: 'user-1',
      sessionInstanceId: 'session-1',
    });

    expect(duplicate).toBe(true);
  });

  it('suppresses same-owner reentry only while the active stage is fresh', async () => {
    hasOutboundArtifactClaimMock.mockResolvedValue(false);
    getOutboundArtifactClaimMock.mockResolvedValue({ ownerInstanceId: 'session-1' });
    getOrchestratorStageForCorrelationMock.mockResolvedValue({
      stage: 'llm',
      startedAtMs: Date.now() - 5_000,
      updatedAtMs: Date.now() - 1_000,
    });

    const { detectDuplicateSessionReplay } = await import('../../src/orchestrator/sessionReplayGuardActivity.js');

    const duplicate = await detectDuplicateSessionReplay({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      userId: 'user-1',
      sessionInstanceId: 'session-1',
    });

    expect(duplicate).toBe(true);
  });

  it('does not suppress same-owner reentry when stage is stale', async () => {
    hasOutboundArtifactClaimMock.mockResolvedValue(false);
    getOutboundArtifactClaimMock.mockResolvedValue({ ownerInstanceId: 'session-1' });
    getOrchestratorStageForCorrelationMock.mockResolvedValue({
      stage: 'llm',
      startedAtMs: Date.now() - 120_000,
      updatedAtMs: Date.now() - 120_000,
    });

    const { detectDuplicateSessionReplay } = await import('../../src/orchestrator/sessionReplayGuardActivity.js');

    const duplicate = await detectDuplicateSessionReplay({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      userId: 'user-1',
      sessionInstanceId: 'session-1',
    });

    expect(duplicate).toBe(false);
  });

  it('does not false-suppress when a conflict occurs but claim read returns null', async () => {
    hasOutboundArtifactClaimMock.mockResolvedValue(false);
    getOutboundArtifactClaimMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    claimOutboundArtifactMock.mockResolvedValue(false);

    const { detectDuplicateSessionReplay } = await import('../../src/orchestrator/sessionReplayGuardActivity.js');

    const duplicate = await detectDuplicateSessionReplay({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      userId: 'user-1',
      sessionInstanceId: 'session-1',
    });

    expect(duplicate).toBe(false);
  });
});