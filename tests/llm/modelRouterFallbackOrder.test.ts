import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadModelRouterWithDefaults() {
  vi.resetModules();

  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
  process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://foundry.example.com';
  process.env['LLM_PRIMARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_SECONDARY_MODEL'] = 'gpt-5.4-mini';
  delete process.env['LLM_FALLBACK_PRIMARY'];
  delete process.env['LLM_FALLBACK_SECONDARY'];

  return import('../../src/llm/modelRouter.js');
}

describe('modelRouter fallback ordering (#411)', () => {
  afterEach(() => {
    delete process.env['LLM_PRIMARY_MODEL'];
    delete process.env['LLM_SECONDARY_MODEL'];
    delete process.env['LLM_FALLBACK_PRIMARY'];
    delete process.env['LLM_FALLBACK_SECONDARY'];
    vi.resetModules();
  });

  it('prefers gpt-5.4-mini immediately after the primary Grok slot by default', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const names = modelRouter.getFallbackChain('grok-4-1-fast-non-reasoning')
      .map((entry) => entry.deploymentName);

    expect(names.slice(0, 4)).toEqual([
      'grok-4-1-fast-non-reasoning',
      'gpt-5.4-mini',
      'DeepSeek-V3.2',
      'FW-Kimi-K2.5',
    ]);
  });

  it('falls from gpt-5.4-mini into tertiary defaults before circling back to Grok primary', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const names = modelRouter.getFallbackChain('gpt-5.4-mini')
      .map((entry) => entry.deploymentName);

    expect(names.slice(0, 4)).toEqual([
      'gpt-5.4-mini',
      'DeepSeek-V3.2',
      'FW-Kimi-K2.5',
      'grok-4-1-fast-non-reasoning',
    ]);
  });
});