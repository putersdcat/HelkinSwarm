import { describe, expect, it, vi } from 'vitest';
import * as df from 'durable-functions';
import {
  getMindSessionGuardEntityId,
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
});