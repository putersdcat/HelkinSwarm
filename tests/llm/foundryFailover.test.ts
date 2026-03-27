import { afterEach, describe, expect, it, vi } from 'vitest';

function makeHeaders(obj: Record<string, string> = {}): Headers {
  return new Headers(obj);
}

async function loadFoundryClientModule() {
  vi.resetModules();

  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
  process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://foundry.example.com';
  process.env['AZURE_FOUNDRY_OBO_TOKEN'] = 'test-obo-token';
  process.env['LLM_PRIMARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_SECONDARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_FALLBACK_PRIMARY'] = 'gpt-5.4-mini';
  process.env['LLM_FALLBACK_SECONDARY'] = 'FW-Kimi-K2.5';

  return import('../../src/llm/foundryClient.js');
}

function makeOkResponse(model: string) {
  return {
    ok: true,
    json: async () => ({
      id: 'chatcmpl-test',
      model,
      created: 1,
      usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: `Response from ${model}` },
      }],
    }),
  };
}

function make429Response(retryAfterSec?: number) {
  const headers: Record<string, string> = {};
  if (retryAfterSec !== undefined) {
    headers['retry-after'] = String(retryAfterSec);
  }
  return {
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    headers: makeHeaders(headers),
    text: async () => JSON.stringify({
      error: { code: 'RateLimitReached', message: 'quota exceeded' },
    }),
  };
}

function make503Response() {
  return {
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    headers: makeHeaders(),
    text: async () => 'Service temporarily unavailable',
  };
}

function makeRoutingConfig() {
  return {
    lane: {
      primary: 'grok-4-1-fast-non-reasoning',
      secondary: 'grok-4-1-fast-non-reasoning',
      embedding: 'text-embedding-3-large',
      reasoning: 'o4-mini',
      vision: 'gpt-5.4-mini',
    },
    laneName: 'global' as const,
    isReasoning: false,
    deploymentName: 'grok-4-1-fast-non-reasoning',
    apiBase: 'https://foundry.example.com',
    usesObo: true,
  };
}

describe('FoundryClient failover', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env['AZURE_FOUNDRY_OBO_TOKEN'];
    delete process.env['LLM_FALLBACK_PRIMARY'];
    delete process.env['LLM_FALLBACK_SECONDARY'];

    const circuitBreaker = await import('../../src/llm/modelCircuitBreaker.js');
    circuitBreaker.resetAllDegraded();
    const tracker = await import('../../src/llm/llmHealthTracker.js');
    tracker.resetLlmHealthTracker();
  });

  it('auto-fails over on HTTP 429 and records a concise operational notice path', async () => {
    const {
      FoundryClient,
      buildSuccessfulFailoverNotices,
    } = await loadFoundryClientModule();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make429Response(10))
      .mockResolvedValueOnce(makeOkResponse('gpt-5.4-mini'));

    vi.stubGlobal('fetch', fetchMock);

    const client = new FoundryClient(makeRoutingConfig());

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

  it('primary 429 → fallback 503 → second fallback success (#313 regression)', async () => {
    const { FoundryClient } = await loadFoundryClientModule();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make429Response(30))   // primary → 429
      .mockResolvedValueOnce(make503Response())      // fallback primary → 503
      .mockResolvedValueOnce(makeOkResponse('FW-Kimi-K2.5')); // fallback secondary → success

    vi.stubGlobal('fetch', fetchMock);

    const client = new FoundryClient(makeRoutingConfig());

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'test multi-hop' }],
      correlationId: 'corr-multi-hop',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(response.model).toBe('FW-Kimi-K2.5');
    expect(response.failoverSteps).toHaveLength(2);
    expect(response.failoverSteps![0].reason).toBe('HTTP 429');
    expect(response.failoverSteps![1].reason).toBe('HTTP 503');
  });

  it('429 with Retry-After header uses that value for circuit breaker cooldown (#313)', async () => {
    const { FoundryClient } = await loadFoundryClientModule();
    const circuitBreaker = await import('../../src/llm/modelCircuitBreaker.js');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make429Response(45))   // 45 seconds retry-after
      .mockResolvedValueOnce(makeOkResponse('gpt-5.4-mini'));

    vi.stubGlobal('fetch', fetchMock);

    const client = new FoundryClient(makeRoutingConfig());

    await client.chatCompletion({
      messages: [{ role: 'user', content: 'test retry-after' }],
      correlationId: 'corr-retry-after',
    });

    // The primary model should be marked degraded with 45s cooldown from Retry-After
    const degraded = circuitBreaker.getDegradedModels();
    const primaryDegraded = degraded.find(d => d.deploymentName === 'grok-4-1-fast-non-reasoning');
    expect(primaryDegraded).toBeDefined();
    expect(primaryDegraded!.cooldownMs).toBe(45_000); // from Retry-After: 45
  });

  it('skips already-degraded models mid-cascade instead of wasting budget (#313-B)', async () => {
    const { FoundryClient } = await loadFoundryClientModule();
    const circuitBreaker = await import('../../src/llm/modelCircuitBreaker.js');

    // Pre-degrade the fallback primary so it's skipped during cascade
    circuitBreaker.markModelDegraded('gpt-5.4-mini', 'HTTP 429');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(make503Response())      // primary → 503
      // gpt-5.4-mini is skipped because it's already degraded
      .mockResolvedValueOnce(makeOkResponse('FW-Kimi-K2.5'));

    vi.stubGlobal('fetch', fetchMock);

    const client = new FoundryClient(makeRoutingConfig());

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'test skip degraded' }],
      correlationId: 'corr-skip-degraded',
    });

    // Should only have 2 fetch calls: primary (503) and FW-Kimi-K2.5 (success)
    // gpt-5.4-mini was skipped entirely
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.model).toBe('FW-Kimi-K2.5');
  });

  it('fast-fails without issuing fetch calls when all known models are down (#325)', async () => {
    const { FoundryClient, FoundryAllModelsDownError } = await loadFoundryClientModule();
    const tracker = await import('../../src/llm/llmHealthTracker.js');

    tracker.registerModels([
      'grok-4-1-fast-non-reasoning',
      'gpt-5.4-mini',
      'FW-Kimi-K2.5',
    ]);
    tracker.reportLlmFailure('grok-4-1-fast-non-reasoning');
    tracker.reportLlmFailure('grok-4-1-fast-non-reasoning');
    tracker.reportLlmFailure('gpt-5.4-mini');
    tracker.reportLlmFailure('gpt-5.4-mini');
    tracker.reportLlmFailure('FW-Kimi-K2.5');
    tracker.reportLlmFailure('FW-Kimi-K2.5');

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const client = new FoundryClient(makeRoutingConfig());

    await expect(client.chatCompletion({
      messages: [{ role: 'user', content: 'hello while down' }],
      correlationId: 'corr-all-down',
    })).rejects.toBeInstanceOf(FoundryAllModelsDownError);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseRetryAfterMs', () => {
  it('parses retry-after header in seconds', async () => {
    const { parseRetryAfterMs } = await loadFoundryClientModule();
    const headers = new Headers({ 'retry-after': '30' });
    expect(parseRetryAfterMs(headers)).toBe(30_000);
  });

  it('parses retry-after-ms header in milliseconds', async () => {
    const { parseRetryAfterMs } = await loadFoundryClientModule();
    const headers = new Headers({ 'retry-after-ms': '5000' });
    expect(parseRetryAfterMs(headers)).toBe(5000);
  });

  it('prefers retry-after-ms over retry-after', async () => {
    const { parseRetryAfterMs } = await loadFoundryClientModule();
    const headers = new Headers({ 'retry-after': '60', 'retry-after-ms': '3000' });
    expect(parseRetryAfterMs(headers)).toBe(3000);
  });

  it('returns undefined when no retry-after headers present', async () => {
    const { parseRetryAfterMs } = await loadFoundryClientModule();
    const headers = new Headers({});
    expect(parseRetryAfterMs(headers)).toBeUndefined();
  });

  it('returns undefined for invalid values', async () => {
    const { parseRetryAfterMs } = await loadFoundryClientModule();
    const headers = new Headers({ 'retry-after': 'Thu, 01 Jan 2099 00:00:00 GMT' });
    expect(parseRetryAfterMs(headers)).toBeUndefined();
  });
});