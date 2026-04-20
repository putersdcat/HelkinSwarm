import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Cosmos before importing the timer module so the registered Functions
// app.timer() handler binds to our fake container. Use vi.hoisted so the
// shared mock fns survive hoisting of vi.mock() to the top of the file.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const fetchAllMock = vi.fn();
  const patchMock = vi.fn();
  const itemMock = vi.fn(() => ({ patch: patchMock }));
  const queryMock = vi.fn(() => ({ fetchAll: fetchAllMock }));
  const trackEventMock = vi.fn();
  const timerMock = vi.fn();
  return { fetchAllMock, patchMock, itemMock, queryMock, trackEventMock, timerMock };
});

vi.mock('../../src/memory/cosmosClient.js', () => ({
  getContainer: () => ({
    items: { query: mocks.queryMock },
    item: mocks.itemMock,
  }),
}));

vi.mock('../../src/observability/telemetry.js', () => ({
  trackEvent: mocks.trackEventMock,
}));

vi.mock('@azure/functions', () => ({
  app: { timer: mocks.timerMock },
}));

import { reconcileStaleSwarmRunningRows } from '../../src/functions/staleSwarmRunningTimer.js';

describe('staleSwarmRunningTimer.reconcileStaleSwarmRunningRows (#693)', () => {
  beforeEach(() => {
    mocks.fetchAllMock.mockReset();
    mocks.patchMock.mockReset();
    mocks.patchMock.mockResolvedValue({});
    mocks.itemMock.mockClear();
    mocks.queryMock.mockClear();
    mocks.trackEventMock.mockClear();
  });

  it('patches each stale running row to status=fail with a clear warning', async () => {
    mocks.fetchAllMock.mockResolvedValueOnce({
      resources: [
        {
          id: 'swarm-A',
          userId: 'user-1',
          swarmId: 'A',
          correlationId: 'corr-A',
          executedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          status: 'running',
        },
        {
          id: 'swarm-B',
          userId: 'user-2',
          swarmId: 'B',
          correlationId: 'corr-B',
          executedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          status: 'running',
        },
      ],
    });

    const stats = await reconcileStaleSwarmRunningRows();

    expect(stats.scanned).toBe(2);
    expect(stats.reconciled).toBe(2);
    expect(stats.failed).toBe(0);

    expect(mocks.itemMock).toHaveBeenCalledTimes(2);
    expect(mocks.itemMock).toHaveBeenNthCalledWith(1, 'swarm-A', 'user-1');
    expect(mocks.itemMock).toHaveBeenNthCalledWith(2, 'swarm-B', 'user-2');

    expect(mocks.patchMock).toHaveBeenCalledTimes(2);
    const firstPatch = mocks.patchMock.mock.calls[0]![0] as Array<{ op: string; path: string; value: unknown }>;
    expect(firstPatch).toEqual(expect.arrayContaining([
      { op: 'replace', path: '/status', value: 'fail' },
      { op: 'replace', path: '/success', value: false },
    ]));
    const warning = firstPatch.find((p) => p.path === '/persistenceWarning');
    expect(warning?.value).toMatch(/Reconciled by staleSwarmRunningTimer/);

    expect(mocks.trackEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'SwarmStaleRunningReconciled',
        correlationId: 'corr-A',
        userId: 'user-1',
      }),
    );
  });

  it('counts patch failures without throwing', async () => {
    mocks.fetchAllMock.mockResolvedValueOnce({
      resources: [
        {
          id: 'swarm-X',
          userId: 'user-x',
          executedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          status: 'running',
        },
      ],
    });
    mocks.patchMock.mockRejectedValueOnce(new Error('cosmos throttled'));

    const stats = await reconcileStaleSwarmRunningRows();

    expect(stats.scanned).toBe(1);
    expect(stats.reconciled).toBe(0);
    expect(stats.failed).toBe(1);
  });

  it('returns zeros and does not throw when the Cosmos query itself fails', async () => {
    mocks.fetchAllMock.mockRejectedValueOnce(new Error('cosmos unreachable'));

    const stats = await reconcileStaleSwarmRunningRows();

    expect(stats).toEqual({ scanned: 0, reconciled: 0, failed: 0 });
    expect(mocks.patchMock).not.toHaveBeenCalled();
  });
});
