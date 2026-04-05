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

describe('ingress task complexity + turn assessment (#531)', () => {
  afterEach(() => {
    delete process.env['LLM_PRIMARY_MODEL'];
    delete process.env['LLM_SECONDARY_MODEL'];
    vi.resetModules();
  });

  it('classifies /heavy turns onto the requested high-capacity lane', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const assessment = modelRouter.getConsciousLaneAssessmentForTurn('primary');
    const complexity = modelRouter.classifyRequestedTaskComplexity({
      userMessage: 'give me a detailed architecture migration plan',
      modelOverride: 'primary',
    });

    expect(assessment.isImpaired).toBe(false);
    expect(assessment.capacityProfile.capacityLevel).toBe('high');
    expect(complexity).toBe('complex');
  });

  it('classifies heavy planning prompts as complex on the default impaired lane', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const assessment = modelRouter.getConsciousLaneAssessmentForTurn();
    const complexity = modelRouter.classifyRequestedTaskComplexity({
      userMessage: 'Please produce a detailed architecture migration plan with step-by-step reasoning.',
    });

    expect(assessment.isImpaired).toBe(true);
    expect(assessment.deploymentName).toBe('gpt-5.4-mini');
    expect(complexity).toBe('complex');
  });

  it('keeps short ordinary turns on the simple path by default', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const complexity = modelRouter.classifyRequestedTaskComplexity({
      userMessage: 'say hello',
    });

    expect(complexity).toBe('simple');
  });

  it('keeps quoted skill-proof follow-ups on the simple path instead of classifying them as heavier quote-context work', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const complexity = modelRouter.classifyRequestedTaskComplexity({
      userMessage: 'Please do a simple functional test of the skill and output the results.',
      hasQuotedContext: true,
    });

    expect(complexity).toBe('simple');
  });

  it('keeps unquoted skill-proof prompts on the simple path too, so live reply-with-quote turns do not depend on quote extraction being present at ingress time', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const complexity = modelRouter.classifyRequestedTaskComplexity({
      userMessage: 'Please do a simple functional test of the skill and output the results.',
    });

    expect(complexity).toBe('simple');
  });

  it('still treats generic quoted follow-ups as compound when they are not explicit proof prompts', async () => {
    const modelRouter = await loadModelRouterWithDefaults();

    const complexity = modelRouter.classifyRequestedTaskComplexity({
      userMessage: 'Can you continue from that quoted reply?',
      hasQuotedContext: true,
    });

    expect(complexity).toBe('compound');
  });
});