import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildMessagePathSnapshot,
  getMessagePathSnapshot,
  recordMessagePathAccepted,
  recordMessagePathFailure,
  recordMessagePathGlobalFailure,
  recordMessagePathStart,
  recordMessagePathSuccess,
  resetMessagePathHealth,
} from '../../src/observability/messagePathHealth.js';

describe('messagePathHealth', () => {
  beforeEach(() => {
    resetMessagePathHealth();
  });

  it('tracks accepted ingress separately from delivered reply success', async () => {
    recordMessagePathStart('turn-1', 1_000);
    await recordMessagePathAccepted('turn-1', 1_500);
    await recordMessagePathSuccess('turn-1', 2_000);

    await expect(getMessagePathSnapshot(2_500)).resolves.toMatchObject({
      status: 'ok',
      pendingTurns: 0,
      lastAcceptedAt: '1970-01-01T00:00:01.500Z',
      lastSuccessAt: '1970-01-01T00:00:02.000Z',
      lastFailureAt: null,
    });
  });

  it('reports degraded after a recent failure until a later success clears it', async () => {
    await recordMessagePathFailure('turn-1', 'send path failed', 10_000);

    await expect(getMessagePathSnapshot(20_000)).resolves.toMatchObject({
      status: 'degraded',
      lastFailureReason: 'send path failed',
    });

    recordMessagePathStart('turn-2', 21_000);
    await recordMessagePathSuccess('turn-2', 22_000);

    await expect(getMessagePathSnapshot(23_000)).resolves.toMatchObject({
      status: 'ok',
      lastFailureAt: null,
      lastFailureReason: null,
    });
  });

  it('reports error when a pending turn is stuck', async () => {
    recordMessagePathStart('turn-1', 1_000);

    await expect(getMessagePathSnapshot(31_500)).resolves.toMatchObject({
      status: 'error',
      pendingTurns: 1,
      oldestPendingAgeMs: 30_500,
    });
  });

  it('records global adapter failures as degraded health', async () => {
    await recordMessagePathGlobalFailure('adapter blew up', 50_000);

    await expect(getMessagePathSnapshot(55_000)).resolves.toMatchObject({
      status: 'degraded',
      lastFailureReason: 'adapter blew up',
    });
  });

  it('lets a newer shared success clear an older shared failure across instances', () => {
    expect(
      buildMessagePathSnapshot({
        nowMs: 80_000,
        pendingTurns: 0,
        oldestPendingAgeMs: null,
        localLastAcceptedAtMs: null,
        localLastSuccessAtMs: null,
        localLastFailureAtMs: null,
        localLastFailureReason: null,
        sharedLastAcceptedAtMs: 65_000,
        sharedLastSuccessAtMs: 70_000,
        sharedLastFailureAtMs: 60_000,
        sharedLastFailureReason: 'older failure',
      }),
    ).toMatchObject({
      status: 'ok',
      lastAcceptedAt: '1970-01-01T00:01:05.000Z',
      lastSuccessAt: '1970-01-01T00:01:10.000Z',
      lastFailureAt: null,
      lastFailureReason: null,
    });
  });
});