import { describe, expect, it, vi } from 'vitest';

async function loadFollowUpModule() {
  vi.resetModules();
  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
  process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://foundry.example.com';
  process.env['AZURE_FOUNDRY_OBO_TOKEN'] = 'test-obo-token';
  process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://content-safety.example.com';
  process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';
  process.env['LLM_PRIMARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_SECONDARY_MODEL'] = 'o4-mini';
  process.env['LLM_FALLBACK_PRIMARY'] = 'o4-mini';
  process.env['LLM_FALLBACK_SECONDARY'] = 'FW-Kimi-K2.5';
  return import('../../src/orchestrator/llmFollowUpActivity.js');
}

describe('mergeFollowUpResponseEvidence', () => {
  it('preserves failover notices from an internal retry-without-tools response and uses the final response model/tokens', async () => {
    const { mergeFollowUpResponseEvidence } = await loadFollowUpModule();
    const evidence = mergeFollowUpResponseEvidence([
      {
        model: 'o4-mini',
        usage: {
          promptTokens: 100,
          completionTokens: 40,
          totalTokens: 140,
        },
        failoverSteps: [],
      },
      {
        model: 'o4-mini',
        usage: {
          promptTokens: 80,
          completionTokens: 30,
          totalTokens: 110,
        },
        failoverSteps: [
          {
            fromModel: 'o4-mini',
            toModel: 'o4-mini',
            reason: 'HTTP 503',
            statusCode: 503,
          },
        ],
      },
    ]);

    expect(evidence.model).toBe('o4-mini');
    expect(evidence.tokensUsed).toBe(250);
    expect(evidence.promptTokens).toBe(180);
    expect(evidence.failoverSteps).toEqual([
      {
        fromModel: 'o4-mini',
        toModel: 'o4-mini',
        reason: 'HTTP 503',
        statusCode: 503,
      },
    ]);
    expect(evidence.operationalNotices).toEqual([
      // o4-mini has capacityLevel:'high' in MODEL_CAPACITY_PROFILES — no cognitive downgrade notice
      '⚠️ Operational note: o4-mini was temporarily unavailable (HTTP 503); auto-failed over to o4-mini and continued your request.',
    ]);
  });

  it('accumulates webSearchRequests across multiple follow-up responses (#650)', async () => {
    const { mergeFollowUpResponseEvidence } = await loadFollowUpModule();
    const evidence = mergeFollowUpResponseEvidence([
      {
        model: 'grok-4-1-fast-non-reasoning',
        usage: {
          promptTokens: 500,
          completionTokens: 200,
          totalTokens: 700,
          serverToolUse: { webSearchRequests: 1 },
        },
        failoverSteps: [],
      },
      {
        model: 'grok-4-1-fast-non-reasoning',
        usage: {
          promptTokens: 400,
          completionTokens: 100,
          totalTokens: 500,
          serverToolUse: { webSearchRequests: 2 },
        },
        failoverSteps: [],
      },
    ]);

    expect(evidence.webSearchRequests).toBe(3);
    expect(evidence.tokensUsed).toBe(1200);
  });

  it('returns undefined webSearchRequests when no responses contain server tool use', async () => {
    const { mergeFollowUpResponseEvidence } = await loadFollowUpModule();
    const evidence = mergeFollowUpResponseEvidence([
      {
        model: 'grok-4-1-fast-non-reasoning',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        failoverSteps: [],
      },
    ]);

    expect(evidence.webSearchRequests).toBeUndefined();
  });
});
