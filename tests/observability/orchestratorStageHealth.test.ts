import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadModuleWithCosmosDouble(options?: {
  deleteThrows?: boolean;
  queryResources?: Array<{
    id: string;
    type: 'orchestrator-stage';
    correlationId: string;
    userId: string;
    stage: string;
    startedAtMs: number;
    updatedAtMs: number;
    ttl: number;
  }>;
}) {
  vi.resetModules();

  const deleteMock = vi.fn(async () => {
    if (options?.deleteThrows) {
      throw new Error('delete failed');
    }
    return undefined;
  });
  const upsertMock = vi.fn(async () => undefined);
  const fetchAllMock = vi.fn(async () => ({ resources: options?.queryResources ?? [] }));

  vi.doMock('../../src/memory/cosmosClient.js', () => ({
    getContainer: () => ({
      item: () => ({ delete: deleteMock }),
      items: {
        upsert: upsertMock,
        query: () => ({ fetchAll: fetchAllMock }),
      },
    }),
  }));

  const mod = await import('../../src/observability/orchestratorStageHealth.js');
  return { ...mod, deleteMock, fetchAllMock, upsertMock };
}

async function loadModule() {
  vi.resetModules();
  vi.doUnmock('../../src/memory/cosmosClient.js');
  return import('../../src/observability/orchestratorStageHealth.js');
}

describe('orchestratorStageHealth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('tracks active turn stages and exposes age ordering', async () => {
    const {
      recordOrchestratorStage,
      getOrchestratorStageSnapshot,
      resetOrchestratorStageHealth,
    } = await loadModule();
    resetOrchestratorStageHealth();

    await recordOrchestratorStage('corr-1', 'build-prompt', 'user-1', 1_000);
    await recordOrchestratorStage('corr-2', 'load-state', 'user-2', 2_000);

    const snapshot = await getOrchestratorStageSnapshot(5_000);
    expect(snapshot.activeTurns).toBe(2);
    expect(snapshot.oldestAgeMs).toBe(4_000);
    expect(snapshot.turns[0]).toMatchObject({ correlationId: 'corr-1', stage: 'build-prompt', ageMs: 4_000 });
    expect(snapshot.turns[1]).toMatchObject({ correlationId: 'corr-2', stage: 'load-state', ageMs: 3_000 });
  });

  it('clears completed turn stages', async () => {
    const {
      clearOrchestratorStage,
      getOrchestratorStageSnapshot,
      recordOrchestratorStage,
      resetOrchestratorStageHealth,
    } = await loadModule();
    resetOrchestratorStageHealth();

    await recordOrchestratorStage('corr-1', 'llm', 'user-1', 10_000);
    await clearOrchestratorStage('corr-1', 'user-1');

    const snapshot = await getOrchestratorStageSnapshot(11_000);
    expect(snapshot.activeTurns).toBe(0);
    expect(snapshot.oldestAgeMs).toBeNull();
    expect(snapshot.turns).toEqual([]);
  });

  it('filters out stale stage entries once they age beyond the stage TTL', async () => {
    const {
      getOrchestratorStageSnapshot,
      recordOrchestratorStage,
      resetOrchestratorStageHealth,
    } = await loadModule();
    resetOrchestratorStageHealth();

    await recordOrchestratorStage('corr-stale', 'build-prompt', 'user-1', 1_000);

    const snapshot = await getOrchestratorStageSnapshot(901_001);
    expect(snapshot.activeTurns).toBe(0);
    expect(snapshot.oldestAgeMs).toBeNull();
    expect(snapshot.turns).toEqual([]);
  });

  it('writes a short-lived cleared tombstone when Cosmos delete fails', async () => {
    const {
      clearOrchestratorStage,
      recordOrchestratorStage,
      resetOrchestratorStageHealth,
      upsertMock,
    } = await loadModuleWithCosmosDouble({ deleteThrows: true });
    resetOrchestratorStageHealth();

    await recordOrchestratorStage('corr-delete-fail', 'build-prompt', 'user-1', 10_000);
    await clearOrchestratorStage('corr-delete-fail', 'user-1');

    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(upsertMock.mock.calls[1]?.[0]).toMatchObject({
      id: 'stage-corr-delete-fail',
      correlationId: 'corr-delete-fail',
      userId: 'user-1',
      stage: 'cleared',
      ttl: 60,
      startedAtMs: 10_000,
    });
  });

  it('ignores cleared tombstones when building the health snapshot from Cosmos', async () => {
    const {
      getOrchestratorStageSnapshot,
      resetOrchestratorStageHealth,
    } = await loadModuleWithCosmosDouble({
      queryResources: [
        {
          id: 'stage-corr-cleared',
          type: 'orchestrator-stage',
          correlationId: 'corr-cleared',
          userId: 'user-1',
          stage: 'cleared',
          startedAtMs: 1_000,
          updatedAtMs: 2_000,
          ttl: 60,
        },
        {
          id: 'stage-corr-active',
          type: 'orchestrator-stage',
          correlationId: 'corr-active',
          userId: 'user-1',
          stage: 'awaiting-confirmation',
          startedAtMs: 3_000,
          updatedAtMs: 4_000,
          ttl: 900,
        },
      ],
    });
    resetOrchestratorStageHealth();

    const snapshot = await getOrchestratorStageSnapshot(5_000);

    expect(snapshot.activeTurns).toBe(1);
    expect(snapshot.turns).toEqual([
      expect.objectContaining({
        correlationId: 'corr-active',
        stage: 'awaiting-confirmation',
      }),
    ]);
  });

  it('prefers fresher in-memory stage updates over older Cosmos stage docs', async () => {
    const {
      getOrchestratorStageSnapshot,
      recordSubstage,
      resetOrchestratorStageHealth,
    } = await loadModuleWithCosmosDouble({
      queryResources: [
        {
          id: 'stage-corr-merge',
          type: 'orchestrator-stage',
          correlationId: 'corr-merge',
          userId: 'user-1',
          stage: 'build-prompt',
          startedAtMs: 1_000,
          updatedAtMs: 2_000,
          ttl: 900,
        },
      ],
    });
    resetOrchestratorStageHealth();
    recordSubstage('corr-merge', 'awaiting-confirmation', 'user-1', 4_000);

    const snapshot = await getOrchestratorStageSnapshot(5_000);

    expect(snapshot.activeTurns).toBe(1);
    expect(snapshot.turns).toEqual([
      expect.objectContaining({
        correlationId: 'corr-merge',
        stage: 'awaiting-confirmation',
      }),
    ]);
  });
});