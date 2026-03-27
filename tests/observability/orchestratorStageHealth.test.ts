import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearOrchestratorStage,
  getOrchestratorStageSnapshot,
  recordOrchestratorStage,
  resetOrchestratorStageHealth,
} from '../../src/observability/orchestratorStageHealth.js';

describe('orchestratorStageHealth', () => {
  beforeEach(() => {
    resetOrchestratorStageHealth();
  });

  it('tracks active turn stages and exposes age ordering', async () => {
    await recordOrchestratorStage('corr-1', 'build-prompt', 'user-1', 1_000);
    await recordOrchestratorStage('corr-2', 'load-state', 'user-2', 2_000);

    const snapshot = await getOrchestratorStageSnapshot(5_000);
    expect(snapshot.activeTurns).toBe(2);
    expect(snapshot.oldestAgeMs).toBe(4_000);
    expect(snapshot.turns[0]).toMatchObject({ correlationId: 'corr-1', stage: 'build-prompt', ageMs: 4_000 });
    expect(snapshot.turns[1]).toMatchObject({ correlationId: 'corr-2', stage: 'load-state', ageMs: 3_000 });
  });

  it('clears completed turn stages', async () => {
    await recordOrchestratorStage('corr-1', 'llm', 'user-1', 10_000);
    await clearOrchestratorStage('corr-1', 'user-1');

    const snapshot = await getOrchestratorStageSnapshot(11_000);
    expect(snapshot.activeTurns).toBe(0);
    expect(snapshot.oldestAgeMs).toBeNull();
    expect(snapshot.turns).toEqual([]);
  });
});