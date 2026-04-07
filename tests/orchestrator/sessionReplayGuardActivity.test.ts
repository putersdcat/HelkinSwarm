import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimOutboundArtifact = vi.fn();
const getOutboundArtifactClaim = vi.fn();
const hasOutboundArtifactClaim = vi.fn();

vi.mock('../../src/bot/conversationStore.js', () => ({
  claimOutboundArtifact,
  getOutboundArtifactClaim,
  hasOutboundArtifactClaim,
}));

describe('sessionReplayGuardActivity', () => {
  beforeEach(() => {
    vi.resetModules();
    claimOutboundArtifact.mockReset();
    getOutboundArtifactClaim.mockReset();
    hasOutboundArtifactClaim.mockReset();
  });

  it('allows the first same-correlation session execution claim to proceed', async () => {
    hasOutboundArtifactClaim.mockResolvedValue(false);
    getOutboundArtifactClaim.mockResolvedValue(undefined);
    claimOutboundArtifact.mockResolvedValue(true);

    const { detectDuplicateSessionReplay } = await import('../../src/orchestrator/sessionReplayGuardActivity.js');

    await expect(detectDuplicateSessionReplay({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      userId: 'user-1',
      sessionInstanceId: 'session-1',
    })).resolves.toBe(false);
  });

  it('suppresses a fresh execution when a session-execution claim already exists for the same correlation', async () => {
    hasOutboundArtifactClaim.mockResolvedValue(false);
    getOutboundArtifactClaim.mockResolvedValue({
      conversationId: 'conv-1',
      userId: 'user-1',
      kind: 'session-execution',
      dedupKey: 'corr-1',
      ownerInstanceId: 'session-1',
      createdAt: '2026-04-07T00:00:00.000Z',
    });

    const { detectDuplicateSessionReplay } = await import('../../src/orchestrator/sessionReplayGuardActivity.js');

    await expect(detectDuplicateSessionReplay({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      userId: 'user-1',
      sessionInstanceId: 'session-1',
    })).resolves.toBe(true);
  });

  it('still suppresses when a visible reply was already claimed', async () => {
    hasOutboundArtifactClaim.mockResolvedValue(true);

    const { detectDuplicateSessionReplay } = await import('../../src/orchestrator/sessionReplayGuardActivity.js');

    await expect(detectDuplicateSessionReplay({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      userId: 'user-1',
      sessionInstanceId: 'session-1',
    })).resolves.toBe(true);
  });
});