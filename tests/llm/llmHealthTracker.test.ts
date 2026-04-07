import { beforeEach, describe, expect, it } from 'vitest';
import {
  getLlmAggregateHealth,
  getLlmHealthSnapshot,
  registerModels,
  reportLlmFailure,
  reportLlmSuccess,
  resetLlmHealthTracker,
} from '../../src/llm/llmHealthTracker.js';

describe('llmHealthTracker', () => {
  beforeEach(() => {
    resetLlmHealthTracker();
  });

  it('is ok by default before any model has failed', () => {
    registerModels(['grok-4-1-fast-non-reasoning', 'o4-mini']);
    expect(getLlmAggregateHealth()).toBe('ok');
  });

  it('becomes degraded when some but not all models are down', () => {
    registerModels(['grok-4-1-fast-non-reasoning', 'o4-mini']);
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    reportLlmFailure('grok-4-1-fast-non-reasoning');

    expect(getLlmAggregateHealth()).toBe('degraded');
  });

  it('becomes down when all known models have consecutive recent failures', () => {
    registerModels(['grok-4-1-fast-non-reasoning', 'o4-mini']);
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    reportLlmFailure('o4-mini');
    reportLlmFailure('o4-mini');

    expect(getLlmAggregateHealth()).toBe('down');
  });

  it('returns to ok after a success on a previously failed model', () => {
    registerModels(['grok-4-1-fast-non-reasoning']);
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    expect(getLlmAggregateHealth()).toBe('down');

    reportLlmSuccess('grok-4-1-fast-non-reasoning');
    expect(getLlmAggregateHealth()).toBe('ok');
  });

  it('exposes per-model snapshot data for diagnostics', () => {
    registerModels(['grok-4-1-fast-non-reasoning']);
    reportLlmFailure('grok-4-1-fast-non-reasoning');
    reportLlmFailure('grok-4-1-fast-non-reasoning');

    const snapshot = getLlmHealthSnapshot();
    expect(snapshot.aggregate).toBe('down');
    expect(snapshot.models).toHaveLength(1);
    expect(snapshot.models[0]?.deploymentName).toBe('grok-4-1-fast-non-reasoning');
    expect(snapshot.models[0]?.consecutiveFailures).toBe(2);
    expect(snapshot.models[0]?.isDown).toBe(true);
    expect(snapshot.models[0]?.lastFailureAt).not.toBeNull();
  });
});