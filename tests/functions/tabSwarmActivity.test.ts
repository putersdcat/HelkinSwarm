import { describe, expect, it } from 'vitest';
import { reconcileSwarmExecutionForDisplay } from '../../src/functions/tabSwarmActivity.js';

describe('reconcileSwarmExecutionForDisplay', () => {
  it('downgrades an old running swarm with no active correlation to fail', () => {
    const now = Date.parse('2026-04-17T22:00:00.000Z');
    const execution = {
      id: 'swarm-1',
      correlationId: 'corr-old',
      executedAt: '2026-04-17T21:00:00.000Z',
      status: 'running',
      success: false,
      executionDurationMs: 0,
    };

    const reconciled = reconcileSwarmExecutionForDisplay(execution, new Set<string>(), now);
    expect(reconciled.status).toBe('fail');
    expect(reconciled.success).toBe(false);
    expect(reconciled.persistenceWarning).toMatch(/Marked stale/);
  });

  it('preserves a running swarm when its correlation is still active', () => {
    const now = Date.parse('2026-04-17T22:00:00.000Z');
    const execution = {
      id: 'swarm-2',
      correlationId: 'corr-live',
      executedAt: '2026-04-17T21:55:00.000Z',
      status: 'running',
      success: false,
    };

    const reconciled = reconcileSwarmExecutionForDisplay(execution, new Set<string>(['corr-live']), now);
    expect(reconciled).toEqual(execution);
  });

  it('preserves a recent running swarm while it is still within the grace window', () => {
    const now = Date.parse('2026-04-17T22:00:00.000Z');
    const execution = {
      id: 'swarm-3',
      correlationId: 'corr-recent',
      executedAt: '2026-04-17T21:50:30.000Z',
      status: 'running',
      success: false,
    };

    const reconciled = reconcileSwarmExecutionForDisplay(execution, new Set<string>(), now);
    expect(reconciled).toEqual(execution);
  });
});
