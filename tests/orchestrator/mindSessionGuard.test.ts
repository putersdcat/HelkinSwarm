import { describe, expect, it, vi } from 'vitest';
import * as df from 'durable-functions';
import {
  applyMindSessionAcquire,
  applyMindSessionRelease,
  getMindSessionGuardEntityId,
  hasReachedInterruptionDepthCap,
  MAX_INTERRUPTION_DEPTH,
  MIND_SESSION_GUARD_ENTITY_NAME,
  readMindSessionGuardState,
} from '../../src/orchestrator/mindSessionGuard.js';

describe('mind session guard helpers', () => {
  it('builds the expected entity id for a user', () => {
    const entityId = getMindSessionGuardEntityId('user-1');
    expect(entityId.name).toBe(MIND_SESSION_GUARD_ENTITY_NAME);
    expect(entityId.key).toBe('user-1');
  });

  it('returns parsed entity state when the durable entity exists', async () => {
    const client = {
      readEntityState: vi.fn(async () => ({
        entityExists: true,
        entityState: {
          activeInstanceId: 'overseer-user-1-abc',
          activeCorrelationId: 'corr-1',
          activeSource: 'teams-message',
          acquisitionCount: 1,
          collisionCount: 0,
        },
      })),
    } as unknown as df.DurableClient;

    const state = await readMindSessionGuardState(client, 'user-1');
    expect(state?.activeInstanceId).toBe('overseer-user-1-abc');
    expect(state?.acquisitionCount).toBe(1);
  });

  it('returns undefined when the durable entity has no state yet', async () => {
    const client = {
      readEntityState: vi.fn(async () => ({ entityExists: false, entityState: undefined })),
    } as unknown as df.DurableClient;

    const state = await readMindSessionGuardState(client, 'user-1');
    expect(state).toBeUndefined();
  });

  it('increments interruption depth on collision acquires and resets on release', () => {
    const first = applyMindSessionAcquire({
      acquisitionCount: 0,
      collisionCount: 0,
      interruptionDepth: 0,
    }, {
      instanceId: 'overseer-1',
      correlationId: 'corr-1',
      source: 'teams-message',
    });

    expect(first.interruptionDepth).toBe(0);
    expect(first.collisionCount).toBe(0);

    const second = applyMindSessionAcquire(first, {
      instanceId: 'overseer-2',
      correlationId: 'corr-2',
      source: 'teams-message',
    });
    const third = applyMindSessionAcquire(second, {
      instanceId: 'overseer-3',
      correlationId: 'corr-3',
      source: 'teams-message',
    });

    expect(second.interruptionDepth).toBe(1);
    expect(third.interruptionDepth).toBe(2);
    expect(third.collisionCount).toBe(2);

    const released = applyMindSessionRelease(third, {
      instanceId: 'overseer-3',
      correlationId: 'corr-3',
    });

    expect(released.activeInstanceId).toBeUndefined();
    expect(released.interruptionDepth).toBe(0);
  });

  it('reports when the interruption depth cap has been reached', () => {
    expect(hasReachedInterruptionDepthCap({
      activeInstanceId: 'overseer-4',
      acquisitionCount: 4,
      collisionCount: 3,
      interruptionDepth: MAX_INTERRUPTION_DEPTH,
    })).toBe(true);
  });
});