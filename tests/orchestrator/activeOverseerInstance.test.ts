import { describe, expect, it } from 'vitest';
import { OrchestrationRuntimeStatus } from 'durable-functions';
import {
  findActiveOverseerInstanceId,
  summarizeActiveOverseerInstances,
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
});