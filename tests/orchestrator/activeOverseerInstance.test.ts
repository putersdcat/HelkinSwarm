import { describe, expect, it } from 'vitest';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import {
  findActiveOverseerInstanceId,
  summarizeActiveOverseerInstances,
  summarizeRoutableOverseerInstances,
  type MinimalOrchestrationStatus,
} from '../../src/orchestrator/activeOverseerInstance.js';
import type { ActiveTurnStage } from '../../src/observability/orchestratorStageHealth.js';
import type { MindSessionGuardState } from '../../src/orchestrator/mindSessionGuard.js';

describe('active overseer instance resolution', () => {
  it('prefers the newest active one-shot overseer instance for the user', () => {
    const result = findActiveOverseerInstanceId([
      {
        instanceId: 'overseer-user-a-old',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-02T15:00:00.000Z',
      },
      {
        instanceId: 'overseer-user-a-new',
        runtimeStatus: OrchestrationRuntimeStatus.Pending,
        createdTime: '2026-04-02T15:05:00.000Z',
      },
      {
        instanceId: 'overseer-user-b-other',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-02T15:10:00.000Z',
      },
    ], 'user-a');

    expect(result).toBe('overseer-user-a-new');
  });

  it('supports the legacy singleton overseer instance id for back-compat', () => {
    const result = findActiveOverseerInstanceId([
      {
        instanceId: 'overseer-user-a',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-02T15:00:00.000Z',
      },
    ], 'user-a');

    expect(result).toBe('overseer-user-a');
  });

  it('returns undefined when no active overseer instance exists for the user', () => {
    const result = findActiveOverseerInstanceId([
      {
        instanceId: 'overseer-user-a-old',
        runtimeStatus: OrchestrationRuntimeStatus.Completed,
        createdTime: '2026-04-02T15:00:00.000Z',
      },
      {
        instanceId: 'session-overseer-user-a',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-02T15:05:00.000Z',
      },
    ], 'user-a');

    expect(result).toBeUndefined();
  });

  it('summarizes active overseer depth for a user', () => {
    const result = summarizeActiveOverseerInstances([
      {
        instanceId: 'overseer-user-a-root',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-02T15:00:00.000Z',
      },
      {
        instanceId: 'overseer-user-a-interrupt-1',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-02T15:01:00.000Z',
      },
      {
        instanceId: 'overseer-user-a-interrupt-2',
        runtimeStatus: OrchestrationRuntimeStatus.Pending,
        createdTime: '2026-04-02T15:02:00.000Z',
      },
      {
        instanceId: 'overseer-user-a-finished',
        runtimeStatus: OrchestrationRuntimeStatus.Completed,
        createdTime: '2026-04-02T15:03:00.000Z',
      },
      {
        instanceId: 'overseer-user-b-other',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-02T15:04:00.000Z',
      },
    ], 'user-a');

    expect(result.activeCount).toBe(3);
    expect(result.latestInstanceId).toBe('overseer-user-a-interrupt-2');
  });

  it('ignores quiescent running overseers when there is no active turn and no guard ownership', () => {
    const result = summarizeRoutableOverseerInstances([
      {
        instanceId: 'overseer-user-a-dedup-hold',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-03T02:00:00.000Z',
      },
    ], 'user-a', [], undefined);

    expect(result.activeCount).toBe(0);
    expect(result.latestInstanceId).toBeUndefined();
  });

  it('does not route to guard residue alone when there are no active turns', () => {
    const result = summarizeRoutableOverseerInstances([
      {
        instanceId: 'overseer-user-a-dedup-hold',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-03T02:00:00.000Z',
      },
    ], 'user-a', [], {
      activeInstanceId: 'overseer-user-a-live',
      activeCorrelationId: 'corr-live',
      activeSource: 'teams-message',
      acquisitionCount: 1,
      collisionCount: 0,
      interruptionDepth: 0,
    });

    expect(result.activeCount).toBe(0);
    expect(result.latestInstanceId).toBeUndefined();
  });

  it('uses guard state when no stage-bound instance exists but the guard points at an active overseer', () => {
    const userId = 'user-a';
    const statuses: MinimalOrchestrationStatus[] = [
      {
        instanceId: 'overseer-user-a-guard',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
      },
    ];
    const activeTurnEntries: ActiveTurnStage[] = [
      {
        correlationId: 'corr-1',
        userId,
        stage: 'awaiting-ingress',
        startedAtMs: 100,
        updatedAtMs: 200,
      },
    ];
    const guardState: MindSessionGuardState = {
      activeInstanceId: 'overseer-user-a-guard',
      activeCorrelationId: 'corr-1',
      activeSource: 'devloop-relay',
      acquisitionCount: 1,
      collisionCount: 0,
      interruptionDepth: 0,
    };

    expect(summarizeRoutableOverseerInstances(statuses, userId, activeTurnEntries, guardState)).toEqual({
      activeCount: 1,
      latestInstanceId: 'overseer-user-a-guard',
    });
  });

  it('prefers the stage-bound instance id during awaiting-ingress routing', () => {
    const result = summarizeRoutableOverseerInstances([
      {
        instanceId: 'overseer-user-a-live-window',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-03T02:00:00.000Z',
      },
      {
        instanceId: 'overseer-user-a-other-running',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-03T02:05:00.000Z',
      },
    ], 'user-a', [{
      correlationId: 'corr-awaiting',
      userId: 'user-a',
      stage: 'awaiting-ingress',
      instanceId: 'overseer-user-a-live-window',
      startedAtMs: 10,
      updatedAtMs: 20,
    }], undefined);

    expect(result.activeCount).toBe(1);
    expect(result.latestInstanceId).toBe('overseer-user-a-live-window');
  });

  it('prefers the freshest stage-bound instance over stale guard state', () => {
    const userId = 'user-a';
    const statuses: MinimalOrchestrationStatus[] = [
      {
        instanceId: 'overseer-user-a-stage',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
      },
    ];
    const activeTurnEntries: ActiveTurnStage[] = [
      {
        correlationId: 'corr-stage',
        userId,
        stage: 'awaiting-ingress',
        instanceId: 'overseer-user-a-stage',
        startedAtMs: 100,
        updatedAtMs: 300,
      },
    ];
    const guardState: MindSessionGuardState = {
      activeInstanceId: 'overseer-user-a-stale',
      activeCorrelationId: 'old-corr',
      activeSource: 'teams-message',
      acquisitionCount: 1,
      collisionCount: 0,
      interruptionDepth: 0,
    };

    expect(summarizeRoutableOverseerInstances(statuses, userId, activeTurnEntries, guardState)).toEqual({
      activeCount: 1,
      latestInstanceId: 'overseer-user-a-stage',
    });
  });

  it('does not route to a stale stage-bound instance when durable status no longer shows it active', () => {
    const userId = 'user-a';
    const statuses: MinimalOrchestrationStatus[] = [];
    const activeTurnEntries: ActiveTurnStage[] = [
      {
        correlationId: 'corr-stale-stage',
        userId,
        stage: 'awaiting-ingress',
        instanceId: 'overseer-user-a-stale-stage',
        startedAtMs: 100,
        updatedAtMs: 200,
      },
    ];

    expect(summarizeRoutableOverseerInstances(statuses, userId, activeTurnEntries, undefined)).toEqual({
      activeCount: 0,
      latestInstanceId: undefined,
    });
  });
});