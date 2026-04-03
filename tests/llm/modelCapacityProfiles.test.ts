import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadModelRouterWithDefaults() {
  vi.resetModules();

  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
  process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://foundry.example.com';
  process.env['LLM_PRIMARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_SECONDARY_MODEL'] = 'gpt-5.4-mini';

  return import('../../src/llm/modelRouter.js');
}

describe('modelRouter capacity profiles (#530)', () => {
  afterEach(() => {
    delete process.env['LLM_PRIMARY_MODEL'];
    delete process.env['LLM_SECONDARY_MODEL'];
    vi.resetModules();
  });

  it('classifies gpt-5.4-mini as a low-capacity impaired lane with defer-heavy-work protocol', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const profile = modelRouter.getModelCapacityProfile('gpt-5.4-mini-2026-03-17');

    expect(profile.capacityLevel).toBe('low');
    expect(profile.impairmentProtocol).toBe('defer-heavy-work');
    expect(profile.unsuitableFor).toContain('orchestration');
  });

  it('surfaces the default global conscious lane as impaired when routing lands on gpt-5.4-mini', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const assessment = modelRouter.getConsciousLaneAssessment();

    expect(assessment.deploymentName).toBe('gpt-5.4-mini');
    expect(assessment.capacityProfile.capacityLevel).toBe('low');
    expect(assessment.isImpaired).toBe(true);
    expect(assessment.summary).toContain('low-capacity impaired state');
  });

  it('keeps o4-mini as a high-capacity full-capability reasoning lane', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const profile = modelRouter.getModelCapacityProfile('o4-mini');

    expect(profile.capacityLevel).toBe('high');
    expect(profile.defaultReasoning).toBe(true);
    expect(profile.impairmentProtocol).toBe('full-capability');
  });
});