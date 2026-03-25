import { describe, expect, it } from 'vitest';
import { deriveRouterOverallStatus } from '../../src/router/routerHealth.js';

describe('router health semantics', () => {
  it('is healthy when routing config and message path are healthy', () => {
    expect(deriveRouterOverallStatus('ok', 'ok', 'ok')).toBe('healthy');
  });

  it('is degraded when routing config is broken', () => {
    expect(deriveRouterOverallStatus('ok', 'error', 'ok')).toBe('degraded');
  });

  it('is degraded on recent message path failure', () => {
    expect(deriveRouterOverallStatus('ok', 'ok', 'degraded')).toBe('degraded');
  });

  it('is unhealthy when the router message path is hard-failed', () => {
    expect(deriveRouterOverallStatus('ok', 'ok', 'error')).toBe('unhealthy');
  });
});