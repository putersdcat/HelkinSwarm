// Unit tests for model circuit breaker (#152, #313)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  markModelDegraded,
  isModelDegraded,
  clearModelDegraded,
  getDegradedModels,
  resetAllDegraded,
  getCooldownForReason,
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

describe('getCooldownForReason — differentiated cooldowns (#313)', () => {
  it('HTTP 429 on first failure gets 5 minutes', () => {
    expect(getCooldownForReason('HTTP 429', 1)).toBe(5 * 60_000);
  });

  it('HTTP 429 on second failure gets 10 minutes', () => {
    expect(getCooldownForReason('HTTP 429', 2)).toBe(10 * 60_000);
  });

  it('HTTP 429 caps at 15 minutes regardless of failure count', () => {
    expect(getCooldownForReason('HTTP 429', 100)).toBe(15 * 60_000);
  });

  it('HTTP 503 gets 2 minutes', () => {
    expect(getCooldownForReason('HTTP 503', 1)).toBe(2 * 60_000);
  });

  it('HTTP 504 gets 2 minutes', () => {
    expect(getCooldownForReason('HTTP 504', 1)).toBe(2 * 60_000);
  });

  // #677: Transient upstream blips (Cloudflare 524 / bad gateway 502 / request
  // timeout 408) get a SHORT 30s cooldown so the primary model rotates back in
  // quickly instead of being locked out for the full default minute.
  it('HTTP 408 gets 30 seconds (transient upstream blip)', () => {
    expect(getCooldownForReason('HTTP 408', 1)).toBe(30_000);
  });

  it('HTTP 502 gets 30 seconds (transient upstream blip)', () => {
    expect(getCooldownForReason('HTTP 502', 1)).toBe(30_000);
  });

  it('HTTP 524 gets 30 seconds (transient upstream blip)', () => {
    expect(getCooldownForReason('HTTP 524', 1)).toBe(30_000);
  });

  it('timeout gets 90 seconds', () => {
    expect(getCooldownForReason('timeout', 1)).toBe(90_000);
  });

  it('unknown reason gets 60 seconds default', () => {
    expect(getCooldownForReason('error', 1)).toBe(60_000);
  });

  it('markModelDegraded stores per-entry cooldown; 429 degraded model stays degraded beyond 60s window', () => {
    markModelDegraded('grok-4-1', 'HTTP 429');
    // The stored cooldown (300_000ms) is used when no override is passed.
    // Passing a 60s override should not force-expire it.
    expect(isModelDegraded('grok-4-1', 60_000)).toBe(true);
  });

  it('timeout degraded model is inspectable with stored 90s cooldown', () => {
    markModelDegraded('grok-4-1', 'timeout');
    // With no override, stored 90s cooldown applies — model is still degraded.
    expect(isModelDegraded('grok-4-1')).toBe(true);
    // With 0ms override, force-expires for test.
    expect(isModelDegraded('grok-4-1', 0)).toBe(false);
  });

  it('repeated 429s escalate the stored cooldown', () => {
    markModelDegraded('m', 'HTTP 429'); // failure 1 → 5m
    const after1 = getDegradedModels().find((d) => d.deploymentName === 'm')?.cooldownMs;
    expect(after1).toBe(5 * 60_000);

    markModelDegraded('m', 'HTTP 429'); // failure 2 → 10m
    const after2 = getDegradedModels().find((d) => d.deploymentName === 'm')?.cooldownMs;
    expect(after2).toBe(10 * 60_000);

    markModelDegraded('m', 'HTTP 429'); // failure 3 → cap 15m
    const after3 = getDegradedModels().find((d) => d.deploymentName === 'm')?.cooldownMs;
    expect(after3).toBe(15 * 60_000);
  });
});
