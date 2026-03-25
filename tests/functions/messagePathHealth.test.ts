import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMessagePathSnapshot,
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

  it('reports ok after a successful turn', () => {
    recordMessagePathStart('turn-1', 1_000);
    recordMessagePathSuccess('turn-1', 2_000);

    expect(getMessagePathSnapshot(2_500)).toMatchObject({
      status: 'ok',
      pendingTurns: 0,
      lastSuccessAt: '1970-01-01T00:00:02.000Z',
      lastFailureAt: null,
    });
  });

  it('reports degraded after a recent failure until a later success clears it', () => {
    recordMessagePathFailure('turn-1', 'send path failed', 10_000);

    expect(getMessagePathSnapshot(20_000)).toMatchObject({
      status: 'degraded',
      lastFailureReason: 'send path failed',
    });

    recordMessagePathStart('turn-2', 21_000);
    recordMessagePathSuccess('turn-2', 22_000);

    expect(getMessagePathSnapshot(23_000)).toMatchObject({
      status: 'ok',
      lastFailureAt: null,
      lastFailureReason: null,
    });
  });

  it('reports error when a pending turn is stuck', () => {
    recordMessagePathStart('turn-1', 1_000);

    expect(getMessagePathSnapshot(31_500)).toMatchObject({
      status: 'error',
      pendingTurns: 1,
      oldestPendingAgeMs: 30_500,
    });
  });

  it('records global adapter failures as degraded health', () => {
    recordMessagePathGlobalFailure('adapter blew up', 50_000);

    expect(getMessagePathSnapshot(55_000)).toMatchObject({
      status: 'degraded',
      lastFailureReason: 'adapter blew up',
    });
  });
});