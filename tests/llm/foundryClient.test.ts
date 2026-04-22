import { EventEmitter } from 'node:events';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { needsNewTokenParam } from '../../src/llm/foundryClient.js';
import {
  getDirectChatModelIncompatibilityReason,
  getSupportedDirectChatModelOverrides,
  isDirectChatModelOverrideSupported,
} from '../../src/llm/modelRouter.js';

afterEach(async () => {
  vi.resetModules();
  delete process.env['OPENROUTER_API_KEY'];
  delete process.env['LLM_PROVIDER'];
  delete process.env['MicrosoftAppId'];
  delete process.env['MicrosoftAppTenantId'];

  const module = await import('../../src/llm/foundryClient.js');
  module._resetRequester();
});

describe('needsNewTokenParam', () => {
  it('uses max_completion_tokens for GPT-5 family models', () => {
    expect(needsNewTokenParam('o4-mini')).toBe(true);
  });

  it('uses max_completion_tokens for GPT-4o family models', () => {
    expect(needsNewTokenParam('gpt-4o-mini')).toBe(true);
  });

  it('uses max_completion_tokens for o-series models', () => {
    expect(needsNewTokenParam('o4-mini')).toBe(true);
  });

  it('keeps legacy max_tokens for non-GPT/non-o chat models', () => {
    expect(needsNewTokenParam('grok-4-1-fast-non-reasoning')).toBe(false);
  });
});

describe('direct chat model override compatibility', () => {
  it('does not advertise codex deployment in /model help', () => {
    expect(getSupportedDirectChatModelOverrides()).not.toContain('gpt-5.1-codex-mini');
  });

  it('marks codex deployment as incompatible with chat completions', () => {
    expect(isDirectChatModelOverrideSupported('gpt-5.1-codex-mini')).toBe(false);
    expect(getDirectChatModelIncompatibilityReason('gpt-5.1-codex-mini')).toContain('chat completions API');
  });

  it('keeps o4-mini available for direct chat override', () => {
    expect(isDirectChatModelOverrideSupported('o4-mini')).toBe(true);
    expect(getDirectChatModelIncompatibilityReason('o4-mini')).toBeUndefined();
  });

  it('rejects friendly aliases that are not real direct /model deployment names', () => {
    expect(isDirectChatModelOverrideSupported('gpt-5')).toBe(false);
    expect(isDirectChatModelOverrideSupported('o3')).toBe(false);
    expect(isDirectChatModelOverrideSupported('gpt-5-mini')).toBe(false);

    expect(getDirectChatModelIncompatibilityReason('gpt-5')).toContain('supported /model deployment name');
    expect(getDirectChatModelIncompatibilityReason('o3')).toContain('supported /model deployment name');
    expect(getDirectChatModelIncompatibilityReason('gpt-5-mini')).toContain('supported /model deployment name');
  });
});

describe('OpenRouter usage cost mapping', () => {
  it('captures usage.cost and usage.cost_details from OpenRouter responses', async () => {
    vi.resetModules();
    process.env['MicrosoftAppId'] = 'test-app-id';
    process.env['MicrosoftAppTenantId'] = 'test-tenant-id';
    process.env['OPENROUTER_API_KEY'] = 'test-openrouter-key';
    process.env['LLM_PROVIDER'] = 'openrouter';

    const module = await import('../../src/llm/foundryClient.js');

    const fakeRequester = ((options: unknown, callback: (res: EventEmitter & {
      statusCode?: number;
      statusMessage?: string;
      headers: Record<string, string>;
    }) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        setTimeout: (ms: number, cb: () => void) => void;
        write: (chunk: string) => void;
        end: () => void;
        destroy: () => void;
      };

      req.setTimeout = (_ms: number, _cb: () => void) => {};
      req.write = (_chunk: string) => {};
      req.destroy = () => {};
      req.end = () => {
        const res = new EventEmitter() as EventEmitter & {
          statusCode?: number;
          statusMessage?: string;
          headers: Record<string, string>;
        };
        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.headers = {};
        callback(res);
        queueMicrotask(() => {
          res.emit('data', Buffer.from(JSON.stringify({
            id: 'resp-1',
            model: 'x-ai/grok-4.1-fast',
            created: 123,
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: 'done',
                },
              },
            ],
            usage: {
              prompt_tokens: 194,
              completion_tokens: 2,
              total_tokens: 196,
              cost: 0.95,
              cost_details: {
                upstream_inference_cost: 19,
              },
            },
          })));
          res.emit('end');
        });
      };

      return req;
    }) as never;

    module._setRequester(fakeRequester);

    const client = new module.FoundryClient({
      lane: {
        primary: 'x-ai/grok-4.1-fast',
        secondary: 'minimax/minimax-m2.7',
        embedding: 'text-embedding-3-large',
        reasoning: 'x-ai/grok-4.1-fast',
        vision: 'x-ai/grok-4.1-fast',
      },
      laneName: 'openrouter',
      isReasoning: true,
      deploymentName: 'x-ai/grok-4.1-fast',
      apiBase: 'https://openrouter.ai/api/v1',
      usesObo: false,
    });

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      correlationId: 'corr-openrouter-cost',
    });

    expect(response.usage.providerCost).toBe(0.95);
    expect(response.usage.providerCostUnit).toBe('credits');
    expect(response.usage.providerCostDetails).toEqual({
      upstream_inference_cost: 19,
    });
  });
});

// ---------------------------------------------------------------------------
// [#690 AC #5] / [#708] Grok 429 retry semantics on the OpenRouter chain
// ---------------------------------------------------------------------------
describe('OpenRouter Grok 429 retry-before-fallback (#690 AC #5, #708)', () => {
  /**
   * Build a multi-call fake `https.request` that walks through `scenarios`
   * one entry per call, recording the deploymentName extracted from the
   * request body so the test can assert which model each call hit.
   */
  function buildScenarioRequester(scenarios: Array<{
    statusCode: number;
    headers?: Record<string, string>;
    bodyModel: string;
  }>) {
    const calls: Array<{ bodyModel: string; sentBodyModel: string | null }> = [];
    let i = 0;
    const requester = ((_options: unknown, callback: (res: EventEmitter & {
      statusCode?: number;
      statusMessage?: string;
      headers: Record<string, string>;
    }) => void) => {
      const idx = i++;
      const scenario = scenarios[idx];
      const req = new EventEmitter() as EventEmitter & {
        setTimeout: (ms: number, cb: () => void) => void;
        write: (chunk: string) => void;
        end: () => void;
        destroy: () => void;
      };
      req.setTimeout = () => {};
      req.destroy = () => {};
      let captured = '';
      req.write = (chunk: string) => { captured += chunk; };
      req.end = () => {
        let sentBodyModel: string | null = null;
        try {
          const parsed = JSON.parse(captured) as { model?: string };
          sentBodyModel = parsed.model ?? null;
        } catch {
          sentBodyModel = null;
        }
        calls.push({ bodyModel: scenario?.bodyModel ?? '', sentBodyModel });
        const res = new EventEmitter() as EventEmitter & {
          statusCode?: number;
          statusMessage?: string;
          headers: Record<string, string>;
        };
        res.statusCode = scenario?.statusCode ?? 500;
        res.statusMessage = scenario?.statusCode === 200 ? 'OK' : 'Err';
        res.headers = scenario?.headers ?? {};
        callback(res);
        queueMicrotask(() => {
          if (scenario?.statusCode === 200) {
            res.emit('data', Buffer.from(JSON.stringify({
              id: 'r',
              model: scenario.bodyModel,
              created: 0,
              choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            })));
          } else {
            res.emit('data', Buffer.from(JSON.stringify({
              error: { code: 'RateLimitReached', message: 'too many' },
            })));
          }
          res.emit('end');
        });
      };
      return req;
    }) as never;
    return { requester, calls };
  }

  function makeOpenRouterClient(module: typeof import('../../src/llm/foundryClient.js')) {
    return new module.FoundryClient({
      lane: {
        primary: 'x-ai/grok-4.1-fast',
        secondary: 'minimax/minimax-m2.7',
        embedding: 'text-embedding-3-large',
        reasoning: 'x-ai/grok-4.1-fast',
        vision: 'x-ai/grok-4.1-fast',
      },
      laneName: 'openrouter',
      isReasoning: false,
      deploymentName: 'x-ai/grok-4.1-fast',
      apiBase: 'https://openrouter.ai/api/v1',
      usesObo: false,
    });
  }

  async function loadOpenRouterModule() {
    vi.resetModules();
    process.env['MicrosoftAppId'] = 'test-app-id';
    process.env['MicrosoftAppTenantId'] = 'test-tenant-id';
    process.env['OPENROUTER_API_KEY'] = 'test-openrouter-key';
    process.env['LLM_PROVIDER'] = 'openrouter';
    process.env['OPENROUTER_FALLBACK_PRIMARY'] = 'minimax/minimax-m2.7';
    const module = await import('../../src/llm/foundryClient.js');
    // Reset cross-test state so prior degraded/down models don't skip Grok.
    const cb = await import('../../src/llm/modelCircuitBreaker.js');
    cb.resetAllDegraded();
    const tracker = await import('../../src/llm/llmHealthTracker.js');
    tracker.resetLlmHealthTracker();
    return module;
  }

  it('retries Grok once on 429 with Retry-After then succeeds without falling back to minimax (#690)', async () => {
    const module = await loadOpenRouterModule();
    const { requester, calls } = buildScenarioRequester([
      { statusCode: 429, headers: { 'retry-after-ms': '1' }, bodyModel: 'x-ai/grok-4.1-fast' },
      { statusCode: 200, bodyModel: 'x-ai/grok-4.1-fast' },
    ]);
    module._setRequester(requester);

    const client = makeOpenRouterClient(module);
    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      correlationId: 'corr-grok-429-retry',
    });

    expect(calls).toHaveLength(2);
    // BOTH calls must hit Grok (the second one is the retry, not minimax).
    expect(calls[0]!.sentBodyModel).toBe('x-ai/grok-4.1-fast');
    expect(calls[1]!.sentBodyModel).toBe('x-ai/grok-4.1-fast');
    expect(response.model).toBe('x-ai/grok-4.1-fast');
    // No failover step recorded — Grok ultimately succeeded on its own slot.
    expect(response.failoverSteps ?? []).toEqual([]);
  });

  it('retries Grok at most once on 429 and falls through to minimax on the second 429 (#708)', async () => {
    const module = await loadOpenRouterModule();
    const { requester, calls } = buildScenarioRequester([
      { statusCode: 429, headers: { 'retry-after-ms': '1' }, bodyModel: 'x-ai/grok-4.1-fast' }, // primary 429
      { statusCode: 429, headers: { 'retry-after-ms': '1' }, bodyModel: 'x-ai/grok-4.1-fast' }, // retry also 429
      { statusCode: 200, bodyModel: 'minimax/minimax-m2.7' },                                // minimax succeeds
    ]);
    module._setRequester(requester);

    const client = makeOpenRouterClient(module);
    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      correlationId: 'corr-grok-429-bounded',
    });

    // Expect EXACTLY 3 https calls: Grok 429, Grok retry 429, minimax 200.
    // If the retry flag were re-declared inside the for-loop body (the #708
    // bug), there would be 4+ Grok calls before falling through.
    expect(calls).toHaveLength(3);
    expect(calls[0]!.sentBodyModel).toBe('x-ai/grok-4.1-fast');
    expect(calls[1]!.sentBodyModel).toBe('x-ai/grok-4.1-fast');
    expect(calls[2]!.sentBodyModel).toBe('minimax/minimax-m2.7');
    expect(response.model).toBe('minimax/minimax-m2.7');
    expect(response.failoverSteps ?? []).toHaveLength(1);
    expect(response.failoverSteps![0]!.fromModel).toBe('x-ai/grok-4.1-fast');
    expect(response.failoverSteps![0]!.toModel).toBe('minimax/minimax-m2.7');
  });
});