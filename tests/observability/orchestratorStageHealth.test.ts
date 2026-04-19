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

  it('does not resurrect a cleared turn when a late background stage write arrives after reply delivery (#681)', async () => {
    const {
      clearOrchestratorStage,
      getOrchestratorStageSnapshot,
      recordOrchestratorStage,
      resetOrchestratorStageHealth,
    } = await loadModule();
    resetOrchestratorStageHealth();

    await recordOrchestratorStage('corr-late-write', 'swarm-decompose', 'user-1', 10_000);
    await clearOrchestratorStage('corr-late-write', 'user-1');

    // Simulate a long-running decomposer or background retry that writes its stage late,
    // after the user-visible reply already cleared the turn.
    await recordOrchestratorStage('corr-late-write', 'swarm-decompose', 'user-1', 12_000);

    const snapshot = await getOrchestratorStageSnapshot(13_000);
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

  it('counts active turns for a specific user without confusing other users', async () => {
    const {
      getActiveTurnCountForUser,
      resetOrchestratorStageHealth,
    } = await loadModuleWithCosmosDouble({
      queryResources: [
        {
          id: 'stage-corr-user-a-1',
          type: 'orchestrator-stage',
          correlationId: 'corr-user-a-1',
          userId: 'user-a',
          stage: 'llm',
          startedAtMs: 1_000,
          updatedAtMs: 2_000,
          ttl: 900,
        },
        {
          id: 'stage-corr-user-a-2',
          type: 'orchestrator-stage',
          correlationId: 'corr-user-a-2',
          userId: 'user-a',
          stage: 'build-prompt',
          startedAtMs: 1_500,
          updatedAtMs: 2_500,
          ttl: 900,
        },
        {
          id: 'stage-corr-user-b-1',
          type: 'orchestrator-stage',
          correlationId: 'corr-user-b-1',
          userId: 'user-b',
          stage: 'plan',
          startedAtMs: 1_700,
          updatedAtMs: 2_700,
          ttl: 900,
        },
      ],
    });
    resetOrchestratorStageHealth();

    await expect(getActiveTurnCountForUser('user-a', 5_000)).resolves.toBe(2);
    await expect(getActiveTurnCountForUser('user-b', 5_000)).resolves.toBe(1);
  });

  it('resets stage age when a turn enters the awaiting-ingress window', async () => {
    const {
      getOrchestratorStageSnapshot,
      recordOrchestratorStage,
      resetOrchestratorStageHealth,
    } = await loadModule();
    resetOrchestratorStageHealth();

    await recordOrchestratorStage('corr-ingress', 'build-prompt', 'user-1', 1_000);
    await recordOrchestratorStage('corr-ingress', 'awaiting-ingress', 'user-1', 5_000, 'overseer-user-1-proof');

    const snapshot = await getOrchestratorStageSnapshot(6_000);
    expect(snapshot.activeTurns).toBe(1);
    expect(snapshot.turns[0]).toMatchObject({
      correlationId: 'corr-ingress',
      stage: 'awaiting-ingress',
      ageMs: 1_000,
      instanceId: 'overseer-user-1-proof',
    });
  });

  it('expires awaiting-ingress stages on a short dedicated freshness window', async () => {
    const {
      getOrchestratorStageSnapshot,
      resetOrchestratorStageHealth,
    } = await loadModuleWithCosmosDouble({
      queryResources: [
        {
          id: 'stage-corr-awaiting-ingress',
          type: 'orchestrator-stage',
          correlationId: 'corr-awaiting-ingress',
          userId: 'user-1',
          stage: 'awaiting-ingress',
          instanceId: 'overseer-user-1-proof',
          startedAtMs: 1_000,
          updatedAtMs: 1_000,
          ttl: 900,
        } as never,
      ],
    });
    resetOrchestratorStageHealth();

    const snapshot = await getOrchestratorStageSnapshot(77_000);
    expect(snapshot.activeTurns).toBe(0);
    expect(snapshot.turns).toEqual([]);
  });

  it('clears active stages by terminated instance id', async () => {
    const {
      clearOrchestratorStagesForInstanceIds,
      getOrchestratorStageSnapshot,
      recordOrchestratorStage,
      resetOrchestratorStageHealth,
    } = await loadModule();
    resetOrchestratorStageHealth();

    const nowMs = Date.now();

    await recordOrchestratorStage('corr-clear-a', 'awaiting-ingress', 'user-1', nowMs - 1_000, 'overseer-user-1-a');
    await recordOrchestratorStage('corr-clear-b', 'awaiting-confirmation', 'user-1', nowMs - 500, 'overseer-user-1-b');

    await expect(clearOrchestratorStagesForInstanceIds(['overseer-user-1-a'])).resolves.toBe(1);

    const snapshot = await getOrchestratorStageSnapshot(nowMs);
    expect(snapshot.activeTurns).toBe(1);
    expect(snapshot.turns).toEqual([
      expect.objectContaining({ correlationId: 'corr-clear-b', stage: 'awaiting-confirmation' }),
    ]);
  });
});