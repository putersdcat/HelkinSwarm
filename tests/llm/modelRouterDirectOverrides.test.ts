import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadModelRouterWithEnv(euResidencyMode: boolean) {
  vi.resetModules();
  process.env['EU_RESIDENCY_MODE'] = euResidencyMode ? 'true' : 'false';
  process.env['MICROSOFT_APP_ID'] = process.env['MICROSOFT_APP_ID'] || 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = process.env['MICROSOFT_APP_TENANT_ID'] || 'test-tenant-id';

  return import('../../src/llm/modelRouter.js');
}

describe('direct /model overrides', () => {
  afterEach(() => {
    delete process.env['EU_RESIDENCY_MODE'];
    vi.resetModules();
  });

  it('hides grok reasoning from the global /model party', async () => {
    const modelRouter = await loadModelRouterWithEnv(false);

    expect(modelRouter.getSupportedDirectChatModelOverrides()).not.toContain('grok-4-1-fast-reasoning');
    expect(modelRouter.getDirectChatModelIncompatibilityReason('grok-4-1-fast-reasoning')).toContain(
      'is disabled in the global lane',
    );
  });

  it('keeps grok reasoning available in EU mode', async () => {
    const modelRouter = await loadModelRouterWithEnv(true);

    expect(modelRouter.getSupportedDirectChatModelOverrides()).toContain('grok-4-1-fast-reasoning');
    expect(modelRouter.getDirectChatModelIncompatibilityReason('grok-4-1-fast-reasoning')).toBeUndefined();
  });
});