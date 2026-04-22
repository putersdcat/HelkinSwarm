import { EventEmitter } from 'node:events';
import type * as https from 'node:https';
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
  process.env['LLM_FALLBACK_PRIMARY'] = 'o4-mini';
  process.env['LLM_FALLBACK_SECONDARY'] = 'FW-Kimi-K2.5';

  return import('../../src/llm/foundryClient.js');
}

// ─── https.request() mock infrastructure ───────────────────────────────────
// Uses the _setRequester() testable seam exported from foundryClient.ts.
// vi.spyOn() cannot be used on node:https because ESM namespace exports are
// non-configurable in Node 22+ (TypeError: Cannot redefine property: request).

interface HttpsScenario {
  statusCode: number;
  statusMessage?: string;
  headers?: Record<string, string>;
  body: string;
}

function makeHttpsOkBody(model: string): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    model,
    created: 1,
    usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: `Response from ${model}` } }],
  });
}

function makeHttpsOkScenario(model: string): HttpsScenario {
  return { statusCode: 200, body: makeHttpsOkBody(model) };
}

function makeHttps429Scenario(retryAfterSec?: number): HttpsScenario {
  const headers: Record<string, string> = {};
  if (retryAfterSec !== undefined) headers['retry-after'] = String(retryAfterSec);
  return {
    statusCode: 429,
    statusMessage: 'Too Many Requests',
    headers,
    body: JSON.stringify({ error: { code: 'RateLimitReached', message: 'quota exceeded' } }),
  };
}

function makeHttps503Scenario(): HttpsScenario {
  return { statusCode: 503, statusMessage: 'Service Unavailable', body: 'Service temporarily unavailable' };
}

function createHttpsMock(scenarios: HttpsScenario[]) {
  let callIndex = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return vi.fn((options: https.RequestOptions, callback: (res: any) => void) => {
    const idx = callIndex++;
    const scenario = scenarios[idx];

    const mockReq = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };

    // Suppress unused-variable lint for `options` — it IS used implicitly for path assertions
    void options;

    mockReq.setTimeout = vi.fn(); // don't fire — timeout logic tested separately
    mockReq.write = vi.fn();
    mockReq.destroy = vi.fn(() => void mockReq.emit('error', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })));
    mockReq.end = vi.fn(() => {
      if (!scenario) {
        setImmediate(() => void mockReq.emit('error', new Error(`No scenario for https.request() call #${idx}`)));
        return;
      }
      setImmediate(() => {
        const mockRes = new EventEmitter() as EventEmitter & { statusCode: number; statusMessage: string; headers: Record<string, string> };
        mockRes.statusCode = scenario.statusCode;
        mockRes.statusMessage = scenario.statusMessage ?? '';
        mockRes.headers = scenario.headers ?? {};
        callback(mockRes);
        setImmediate(() => {
          mockRes.emit('data', Buffer.from(scenario.body));
          mockRes.emit('end');
        });
      });
    });

    return mockReq;
  });
}

type HttpsMock = ReturnType<typeof createHttpsMock>;

/** Return the `path` string from a specific call of an https mock. */
function callPath(mock: HttpsMock, callIdx: number): string {
  return ((mock.mock.calls[callIdx]?.[0]) as https.RequestOptions | undefined)?.path ?? '';
}

// ─── Legacy helpers still used by fetchWithHardTimeout tests ────────────────

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

function makeRoutingConfig() {
  return {
    lane: {
      primary: 'grok-4-1-fast-non-reasoning',
      secondary: 'grok-4-1-fast-non-reasoning',
      embedding: 'text-embedding-3-large',
      reasoning: 'o4-mini',
      vision: 'o4-mini',
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env['AZURE_FOUNDRY_OBO_TOKEN'];
    delete process.env['LLM_FALLBACK_PRIMARY'];
    delete process.env['LLM_FALLBACK_SECONDARY'];

    const circuitBreaker = await import('../../src/llm/modelCircuitBreaker.js');
    circuitBreaker.resetAllDegraded();
    const proof = await import('../../src/llm/modelFailoverProof.js');
    proof.resetForcedRetryableFailures();
    const tracker = await import('../../src/llm/llmHealthTracker.js');
    tracker.resetLlmHealthTracker();
  });

  it('auto-fails over on HTTP 429 and records a concise operational notice path', async () => {
    const {
      FoundryClient,
      buildSuccessfulFailoverNotices,
      _setRequester,
    } = await loadFoundryClientModule();

    const httpsMock = createHttpsMock([makeHttps429Scenario(10), makeHttpsOkScenario('o4-mini')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setRequester(httpsMock as any);

    const client = new FoundryClient(makeRoutingConfig());

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      correlationId: 'corr-429',
    });

    expect(httpsMock).toHaveBeenCalledTimes(2);
    expect(callPath(httpsMock, 0)).toContain('/deployments/grok-4-1-fast-non-reasoning/chat/completions');
    expect(callPath(httpsMock, 1)).toContain('/deployments/o4-mini/chat/completions');
    expect(response.model).toBe('o4-mini');
    expect(response.failoverSteps).toEqual([
      {
        fromModel: 'grok-4-1-fast-non-reasoning',
        toModel: 'o4-mini',
        reason: 'HTTP 429',
        statusCode: 429,
      },
    ]);
    expect(buildSuccessfulFailoverNotices(response.failoverSteps)).toEqual([
      // o4-mini has capacityLevel:'high' in MODEL_CAPACITY_PROFILES — no cognitive downgrade notice
      '⚠️ Operational note: grok-4-1-fast-non-reasoning hit a 429 quota/rate limit; auto-failed over to o4-mini and continued your request.',
    ]);
  });

  it('primary 429 → fallback 503 → second fallback success (#313 regression)', async () => {
    const { FoundryClient, _setRequester } = await loadFoundryClientModule();

    const httpsMock = createHttpsMock([
      makeHttps429Scenario(30),        // primary → 429
      makeHttps503Scenario(),          // fallback primary → 503
      makeHttpsOkScenario('FW-Kimi-K2.5'), // fallback secondary → success
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setRequester(httpsMock as any);

    const client = new FoundryClient(makeRoutingConfig());

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'test multi-hop' }],
      correlationId: 'corr-multi-hop',
    });

    expect(httpsMock).toHaveBeenCalledTimes(3);
    expect(response.model).toBe('FW-Kimi-K2.5');
    expect(response.failoverSteps).toHaveLength(2);
    expect(response.failoverSteps![0].reason).toBe('HTTP 429');
    expect(response.failoverSteps![1].reason).toBe('HTTP 503');
  });

  it('adds an impairment disclosure only when failover lands on a low-capacity model', async () => {
    const { buildSuccessfulFailoverNotices } = await loadFoundryClientModule();

    expect(buildSuccessfulFailoverNotices([
      {
        fromModel: 'o4-mini',
        toModel: 'FW-Kimi-K2.5',
        reason: 'HTTP 503',
        statusCode: 503,
      },
    ])).toEqual([
      '⚠️ Operational note: o4-mini was temporarily unavailable (HTTP 503); auto-failed over to FW-Kimi-K2.5 and continued your request.',
    ]);
  });

  it('prefers medium-capacity fallbacks before the low-capacity lane for heavy reasoning requests', async () => {
    const { FoundryClient, _setRequester } = await loadFoundryClientModule();

    const httpsMock = createHttpsMock([
      makeHttps503Scenario(),
      makeHttpsOkScenario('grok-4-1-fast-non-reasoning'),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setRequester(httpsMock as any);

    const client = new FoundryClient({
      ...makeRoutingConfig(),
      deploymentName: 'o4-mini',
      isReasoning: true,
    });

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'heavy reasoning request' }],
      correlationId: 'corr-heavy-order',
      requestedTaskComplexity: 'complex',
    });

    expect(httpsMock).toHaveBeenCalledTimes(2);
    expect(callPath(httpsMock, 0)).toContain('/deployments/o4-mini/chat/completions');
    expect(callPath(httpsMock, 1)).not.toContain('/deployments/o4-mini/chat/completions');
    expect(response.model).toBe('grok-4-1-fast-non-reasoning');
    expect(response.failoverSteps).toEqual([
      {
        fromModel: 'o4-mini',
        toModel: 'grok-4-1-fast-non-reasoning',
        reason: 'HTTP 503',
        statusCode: 503,
      },
    ]);
  });

  it('429 with Retry-After header uses that value for circuit breaker cooldown (#313)', async () => {
    const { FoundryClient, _setRequester } = await loadFoundryClientModule();
    const circuitBreaker = await import('../../src/llm/modelCircuitBreaker.js');

    const httpsMock = createHttpsMock([makeHttps429Scenario(45), makeHttpsOkScenario('o4-mini')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setRequester(httpsMock as any);

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
    const { FoundryClient, _setRequester } = await loadFoundryClientModule();
    const circuitBreaker = await import('../../src/llm/modelCircuitBreaker.js');

    // Pre-degrade the fallback primary so it's skipped during cascade
    circuitBreaker.markModelDegraded('o4-mini', 'HTTP 429');

    const httpsMock = createHttpsMock([
      makeHttps503Scenario(),           // primary → 503
      makeHttpsOkScenario('FW-Kimi-K2.5'), // o4-mini skipped, FW-Kimi-K2.5 → success
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setRequester(httpsMock as any);

    const client = new FoundryClient(makeRoutingConfig());

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'test skip degraded' }],
      correlationId: 'corr-skip-degraded',
    });

    // Should only have 2 calls: primary (503) and FW-Kimi-K2.5 (success)
    // o4-mini was skipped entirely
    expect(httpsMock).toHaveBeenCalledTimes(2);
    expect(response.model).toBe('FW-Kimi-K2.5');
  });

  it('skips a primary model already marked down by the aggregate health tracker and starts on the next fallback', async () => {
    const { FoundryClient, _setRequester } = await loadFoundryClientModule();
    const tracker = await import('../../src/llm/llmHealthTracker.js');

    tracker.reportLlmFailure('grok-4-1-fast-non-reasoning');
    tracker.reportLlmFailure('grok-4-1-fast-non-reasoning');

    const httpsMock = createHttpsMock([makeHttpsOkScenario('o4-mini')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setRequester(httpsMock as any);

    const client = new FoundryClient(makeRoutingConfig());

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'skip the down primary' }],
      correlationId: 'corr-skip-down-primary',
    });

    expect(httpsMock).toHaveBeenCalledTimes(1);
    expect(callPath(httpsMock, 0)).toContain('/deployments/o4-mini/chat/completions');
    expect(response.model).toBe('o4-mini');
  });

  it('converts a hung fetch into a TimeoutError via the hard timeout wrapper (#325)', async () => {
    const { fetchWithHardTimeout } = await loadFoundryClientModule();

    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithHardTimeout('https://foundry.example.com/test', {
      method: 'POST',
      headers: {},
      body: '{}',
    }, 20)).rejects.toMatchObject({ name: 'TimeoutError' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fast-fails without issuing fetch calls when all known models are down (#325)', async () => {
    const { FoundryClient, FoundryAllModelsDownError, _setRequester } = await loadFoundryClientModule();
    const tracker = await import('../../src/llm/llmHealthTracker.js');

    tracker.registerModels([
      'grok-4-1-fast-non-reasoning',
      'o4-mini',
      'FW-Kimi-K2.5',
    ]);
    tracker.reportLlmFailure('grok-4-1-fast-non-reasoning');
    tracker.reportLlmFailure('grok-4-1-fast-non-reasoning');
    tracker.reportLlmFailure('o4-mini');
    tracker.reportLlmFailure('o4-mini');
    tracker.reportLlmFailure('FW-Kimi-K2.5');
    tracker.reportLlmFailure('FW-Kimi-K2.5');

    const httpsMock = createHttpsMock([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setRequester(httpsMock as any);

    const client = new FoundryClient(makeRoutingConfig());

    await expect(client.chatCompletion({
      messages: [{ role: 'user', content: 'hello while down' }],
      correlationId: 'corr-all-down',
    })).rejects.toBeInstanceOf(FoundryAllModelsDownError);

    expect(httpsMock).not.toHaveBeenCalled();
  });

  it('supports proof-only forced retryable failures that traverse the real failover notice path', async () => {
    const { FoundryClient, buildSuccessfulFailoverNotices, _setRequester } = await loadFoundryClientModule();
    const proof = await import('../../src/llm/modelFailoverProof.js');

    // Seed forced failure only for the PRIMARY model, leaving o4-mini (first fallback) free
    // This verifies that proof-mechanism failures are injected without making a real HTTP call,
    // but the fallback chain correctly continues to a real callSingleModel call on the next candidate.
    proof.seedForcedRetryableFailure('grok-4-1-fast-non-reasoning', 'proof-failover', 503);

    const httpsMock = createHttpsMock([makeHttpsOkScenario('o4-mini')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setRequester(httpsMock as any);

    const client = new FoundryClient(makeRoutingConfig()); // starts on grok-4-1-fast-non-reasoning

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'failover proof test' }],
      correlationId: 'corr-proof-failover',
    });

    // Only o4-mini was called via real HTTP (grok was short-circuited by the proof mechanism)
    expect(httpsMock).toHaveBeenCalledTimes(1);
    expect(callPath(httpsMock, 0)).toContain('/deployments/o4-mini/chat/completions');
    expect(response.model).toBe('o4-mini');
    expect(response.failoverSteps).toEqual([
      {
        fromModel: 'grok-4-1-fast-non-reasoning',
        toModel: 'o4-mini',
        reason: 'HTTP 503',
        statusCode: 503,
      },
    ]);
    // o4-mini has capacityLevel:'high' in MODEL_CAPACITY_PROFILES — no cognitive downgrade notice
    expect(buildSuccessfulFailoverNotices(response.failoverSteps)).toHaveLength(1);
    expect(buildSuccessfulFailoverNotices(response.failoverSteps)).toEqual([
      '⚠️ Operational note: grok-4-1-fast-non-reasoning was temporarily unavailable (HTTP 503); auto-failed over to o4-mini and continued your request.',
    ]);
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

describe('parseRetryAfterMsFromNodeHeaders (#677)', () => {
  it('honours Retry-After on 429', async () => {
    const { parseRetryAfterMsFromNodeHeaders } = await loadFoundryClientModule();
    expect(parseRetryAfterMsFromNodeHeaders({ 'retry-after': '30' }, 429)).toBe(30_000);
  });

  it('honours Retry-After on 502 (upstream gateway)', async () => {
    const { parseRetryAfterMsFromNodeHeaders } = await loadFoundryClientModule();
    expect(parseRetryAfterMsFromNodeHeaders({ 'retry-after': '15' }, 502)).toBe(15_000);
  });

  it('honours Retry-After on 503 (origin overload)', async () => {
    const { parseRetryAfterMsFromNodeHeaders } = await loadFoundryClientModule();
    expect(parseRetryAfterMsFromNodeHeaders({ 'retry-after': '20' }, 503)).toBe(20_000);
  });

  it('honours Retry-After on 524 (Cloudflare timeout)', async () => {
    const { parseRetryAfterMsFromNodeHeaders } = await loadFoundryClientModule();
    expect(parseRetryAfterMsFromNodeHeaders({ 'retry-after': '10' }, 524)).toBe(10_000);
  });

  it('prefers retry-after-ms (already milliseconds) over retry-after (seconds)', async () => {
    const { parseRetryAfterMsFromNodeHeaders } = await loadFoundryClientModule();
    expect(parseRetryAfterMsFromNodeHeaders(
      { 'retry-after': '60', 'retry-after-ms': '2500' },
      503,
    )).toBe(2500);
  });

  it('does NOT honour Retry-After on non-honoured statuses (e.g. 500, 504)', async () => {
    const { parseRetryAfterMsFromNodeHeaders } = await loadFoundryClientModule();
    expect(parseRetryAfterMsFromNodeHeaders({ 'retry-after': '30' }, 500)).toBeUndefined();
    expect(parseRetryAfterMsFromNodeHeaders({ 'retry-after': '30' }, 504)).toBeUndefined();
    expect(parseRetryAfterMsFromNodeHeaders({ 'retry-after': '30' }, 400)).toBeUndefined();
  });

  it('handles array-shaped header values (Node IncomingHttpHeaders)', async () => {
    const { parseRetryAfterMsFromNodeHeaders } = await loadFoundryClientModule();
    expect(parseRetryAfterMsFromNodeHeaders({ 'retry-after': ['45'] }, 429)).toBe(45_000);
  });

  it('returns undefined when status is unknown', async () => {
    const { parseRetryAfterMsFromNodeHeaders } = await loadFoundryClientModule();
    expect(parseRetryAfterMsFromNodeHeaders({ 'retry-after': '30' }, undefined)).toBeUndefined();
  });
});