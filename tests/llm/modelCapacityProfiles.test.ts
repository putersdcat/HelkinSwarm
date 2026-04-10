import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadModelRouterWithDefaults() {
  vi.resetModules();

  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
  process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://foundry.example.com';
  process.env['LLM_PRIMARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_SECONDARY_MODEL'] = 'o4-mini';

  return import('../../src/llm/modelRouter.js');
}

describe('modelRouter capacity profiles (#530)', () => {
  afterEach(() => {
    delete process.env['LLM_PRIMARY_MODEL'];
    delete process.env['LLM_SECONDARY_MODEL'];
    vi.resetModules();
  });

  it('classifies o4-mini as a high-capacity reasoning lane with full-capability protocol', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const profile = modelRouter.getModelCapacityProfile('o4-mini-2026-03-17');

    expect(profile.capacityLevel).toBe('high');
    expect(profile.impairmentProtocol).toBe('full-capability');
    expect(profile.defaultReasoning).toBe(true);
  });

  it('surfaces the default global conscious lane as full-capability when routing lands on o4-mini', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const assessment = modelRouter.getConsciousLaneAssessment();

    expect(assessment.deploymentName).toBe('o4-mini');
    expect(assessment.capacityProfile.capacityLevel).toBe('high');
    expect(assessment.isImpaired).toBe(false);
    expect(assessment.summary).toContain('high capacity');
  });

  it('keeps o4-mini as a high-capacity full-capability reasoning lane', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const profile = modelRouter.getModelCapacityProfile('o4-mini');

    expect(profile.capacityLevel).toBe('high');
    expect(profile.defaultReasoning).toBe(true);
    expect(profile.impairmentProtocol).toBe('full-capability');
  });
});