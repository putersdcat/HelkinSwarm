import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function seedDegradedLane(deploymentName: string) {
  const circuitBreaker = await import('../../src/llm/modelCircuitBreaker.js');
  circuitBreaker.markModelDegraded(deploymentName, 'HTTP 503', 60_000);
}

async function seedTrackedDownLane(deploymentName: string) {
  const healthTracker = await import('../../src/llm/llmHealthTracker.js');
  healthTracker.registerModels([deploymentName]);
  healthTracker.reportLlmFailure(deploymentName);
  healthTracker.reportLlmFailure(deploymentName);
}

async function loadModelRouterWithDefaults() {
  vi.resetModules();

  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
  process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://foundry.example.com';
  process.env['LLM_PRIMARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_SECONDARY_MODEL'] = 'o4-mini';
  delete process.env['LLM_FALLBACK_PRIMARY'];
  delete process.env['LLM_FALLBACK_SECONDARY'];

  return import('../../src/llm/modelRouter.js');
}

describe('modelRouter fallback ordering (#411)', () => {
  beforeEach(async () => {
    const circuitBreaker = await import('../../src/llm/modelCircuitBreaker.js');
    const healthTracker = await import('../../src/llm/llmHealthTracker.js');
    circuitBreaker.resetAllDegraded();
    healthTracker.resetLlmHealthTracker();
  });

  afterEach(() => {
    delete process.env['LLM_PRIMARY_MODEL'];
    delete process.env['LLM_SECONDARY_MODEL'];
    delete process.env['LLM_FALLBACK_PRIMARY'];
    delete process.env['LLM_FALLBACK_SECONDARY'];
    vi.resetModules();
  });

  it('prefers o4-mini immediately after the primary Grok slot by default', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const names = modelRouter.getFallbackChain('grok-4-1-fast-non-reasoning')
      .map((entry) => entry.deploymentName);

    expect(names.slice(0, 4)).toEqual([
      'grok-4-1-fast-non-reasoning',
      'o4-mini',
      'DeepSeek-V3.2',
      'FW-Kimi-K2.5',
    ]);
  });

  it('routes unlabeled global prompts through the reasoning secondary lane during active development', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const routing = modelRouter.getModelRouting();

    expect(routing.deploymentName).toBe('o4-mini');
    expect(routing.isReasoning).toBe(true);
  });

  it('automatically restores ordinary routing to the high-capacity reasoning lane when the impaired default lane is degraded', async () => {
    const modelRouter = await loadModelRouterWithDefaults();
    await seedDegradedLane('o4-mini');

    const routing = modelRouter.getModelRouting();

    expect(routing.deploymentName).toBe('o4-mini');
    expect(routing.isReasoning).toBe(true);
  });

  it('automatically restores ordinary routing when the impaired default lane is tracked down by health signals', async () => {
    const modelRouter = await loadModelRouterWithDefaults();
    await seedTrackedDownLane('o4-mini');

    const routing = modelRouter.getModelRouting();

    expect(routing.deploymentName).toBe('o4-mini');
    expect(routing.isReasoning).toBe(true);
  });

  it('keeps routing on o4-mini even when both circuit-breaker slots are degraded since it is high-capacity', async () => {
    const modelRouter = await loadModelRouterWithDefaults();
    await seedDegradedLane('o4-mini');
    await seedDegradedLane('o4-mini');

    const routing = modelRouter.getModelRouting();

    expect(routing.deploymentName).toBe('o4-mini');
  });

  it('falls from o4-mini into tertiary defaults before circling back to Grok primary', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const names = modelRouter.getFallbackChain('o4-mini')
      .map((entry) => entry.deploymentName);

    expect(names.slice(0, 4)).toEqual([
      'o4-mini',
      'DeepSeek-V3.2',
      'FW-Kimi-K2.5',
      'grok-4-1-fast-non-reasoning',
    ]);
  });
});