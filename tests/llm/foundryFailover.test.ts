import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadFoundryClientModule() {
  vi.resetModules();

  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
  process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://foundry.example.com';
  process.env['AZURE_FOUNDRY_OBO_TOKEN'] = 'test-obo-token';
  process.env['LLM_PRIMARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_SECONDARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_FALLBACK_PRIMARY'] = 'gpt-5.4-mini';

  return import('../../src/llm/foundryClient.js');
}

describe('FoundryClient failover', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env['AZURE_FOUNDRY_OBO_TOKEN'];
    delete process.env['LLM_FALLBACK_PRIMARY'];

    const circuitBreaker = await import('../../src/llm/modelCircuitBreaker.js');
    circuitBreaker.resetAllDegraded();
  });

  it('auto-fails over on HTTP 429 and records a concise operational notice path', async () => {
    const {
      FoundryClient,
      buildSuccessfulFailoverNotices,
    } = await loadFoundryClientModule();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => JSON.stringify({
          error: {
            code: 'RateLimitReached',
            message: 'quota exceeded',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-test',
          model: 'gpt-5.4-mini',
          created: 1,
          usage: {
            prompt_tokens: 12,
            completion_tokens: 7,
            total_tokens: 19,
          },
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'Fallback response',
              },
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const client = new FoundryClient({
      lane: {
        primary: 'grok-4-1-fast-non-reasoning',
        secondary: 'grok-4-1-fast-non-reasoning',
        embedding: 'text-embedding-3-large',
        reasoning: 'o4-mini',
        vision: 'gpt-5.4-mini',
      },
      laneName: 'global',
      isReasoning: false,
      deploymentName: 'grok-4-1-fast-non-reasoning',
      apiBase: 'https://foundry.example.com',
      usesObo: true,
    });

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      correlationId: 'corr-429',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/deployments/grok-4-1-fast-non-reasoning/chat/completions');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/deployments/gpt-5.4-mini/chat/completions');
    expect(response.model).toBe('gpt-5.4-mini');
    expect(response.failoverSteps).toEqual([
      {
        fromModel: 'grok-4-1-fast-non-reasoning',
        toModel: 'gpt-5.4-mini',
        reason: 'HTTP 429',
        statusCode: 429,
      },
    ]);
    expect(buildSuccessfulFailoverNotices(response.failoverSteps)).toEqual([
      '⚠️ Operational note: grok-4-1-fast-non-reasoning hit a 429 quota/rate limit; auto-failed over to gpt-5.4-mini and continued your request.',
    ]);
  });
});