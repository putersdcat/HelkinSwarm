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