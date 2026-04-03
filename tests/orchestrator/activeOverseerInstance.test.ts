import { describe, expect, it } from 'vitest';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import {
  findActiveOverseerInstanceId,
  summarizeActiveOverseerInstances,
  summarizeRoutableOverseerInstances,
} from '../../src/orchestrator/activeOverseerInstance.js';

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
    ], 'user-a', 0, undefined);

    expect(result.activeCount).toBe(0);
    expect(result.latestInstanceId).toBeUndefined();
  });

  it('prefers guard-owned active instance for routable delivery', () => {
    const result = summarizeRoutableOverseerInstances([
      {
        instanceId: 'overseer-user-a-dedup-hold',
        runtimeStatus: OrchestrationRuntimeStatus.Running,
        createdTime: '2026-04-03T02:00:00.000Z',
      },
    ], 'user-a', 0, {
      activeInstanceId: 'overseer-user-a-live',
      activeCorrelationId: 'corr-live',
      activeSource: 'teams-message',
      acquisitionCount: 1,
      collisionCount: 0,
      interruptionDepth: 0,
    });

    expect(result.activeCount).toBe(1);
    expect(result.latestInstanceId).toBe('overseer-user-a-live');
  });
});