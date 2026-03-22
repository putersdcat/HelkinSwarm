// Unit tests for model circuit breaker (#152)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  markModelDegraded,
  isModelDegraded,
  clearModelDegraded,
  getDegradedModels,
  resetAllDegraded,
} from '../../src/llm/modelCircuitBreaker.js';

describe('modelCircuitBreaker', () => {
  beforeEach(() => {
    resetAllDegraded();
  });

  it('marks a model as degraded and detects it', () => {
    expect(isModelDegraded('grok-4-1')).toBe(false);
    markModelDegraded('grok-4-1', 'HTTP 429');
    expect(isModelDegraded('grok-4-1')).toBe(true);
  });

  it('degraded model is skipped within cooldown window', () => {
    markModelDegraded('grok-4-1', 'timeout');
    // Within default 60s cooldown
    expect(isModelDegraded('grok-4-1', 60_000)).toBe(true);
  });

  it('cooldown expiry re-enables model', () => {
    markModelDegraded('grok-4-1', 'HTTP 429');
    // Simulate cooldown expired by using 0ms cooldown
    expect(isModelDegraded('grok-4-1', 0)).toBe(false);
  });

  it('clearModelDegraded immediately re-enables model', () => {
    markModelDegraded('grok-4-1', 'HTTP 503');
    expect(isModelDegraded('grok-4-1')).toBe(true);
    clearModelDegraded('grok-4-1');
    expect(isModelDegraded('grok-4-1')).toBe(false);
  });

  it('tracks failure count across multiple degradations', () => {
    markModelDegraded('grok-4-1', 'HTTP 429');
    markModelDegraded('grok-4-1', 'HTTP 429');
    markModelDegraded('grok-4-1', 'timeout');
    const models = getDegradedModels();
    expect(models).toHaveLength(1);
    expect(models[0].failureCount).toBe(3);
    expect(models[0].reason).toBe('timeout'); // latest reason
  });

  it('handles multiple degraded models independently', () => {
    markModelDegraded('model-a', 'HTTP 429');
    markModelDegraded('model-b', 'HTTP 503');
    expect(isModelDegraded('model-a')).toBe(true);
    expect(isModelDegraded('model-b')).toBe(true);
    clearModelDegraded('model-a');
    expect(isModelDegraded('model-a')).toBe(false);
    expect(isModelDegraded('model-b')).toBe(true);
  });

  it('getDegradedModels returns all degraded entries', () => {
    markModelDegraded('m1', 'a');
    markModelDegraded('m2', 'b');
    expect(getDegradedModels()).toHaveLength(2);
  });

  it('resetAllDegraded clears everything', () => {
    markModelDegraded('m1', 'a');
    markModelDegraded('m2', 'b');
    resetAllDegraded();
    expect(getDegradedModels()).toHaveLength(0);
    expect(isModelDegraded('m1')).toBe(false);
  });
});
