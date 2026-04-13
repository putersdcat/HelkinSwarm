// Tests for FoundryClient streaming (SSE) support — #637 Phase 1
// Covers: onToken option wiring, SSE response parsing, token count accuracy,
//         tool_calls accumulation from deltas.

import { EventEmitter } from 'node:events';
import { describe, expect, it, afterEach, vi } from 'vitest';
import type { FoundryClientOptions } from '../../src/llm/foundryClient.js';

afterEach(async () => {
  vi.resetModules();
  delete process.env['OPENROUTER_API_KEY'];
  delete process.env['LLM_PROVIDER'];
  delete process.env['MicrosoftAppId'];
  delete process.env['MicrosoftAppTenantId'];

  const module = await import('../../src/llm/foundryClient.js');
  module._resetRequester();
});

// ---------------------------------------------------------------------------
// Type-level tests — onToken is a valid FoundryClientOptions field
// ---------------------------------------------------------------------------

describe('FoundryClientOptions.onToken type surface', () => {
  it('accepts onToken callback', () => {
    const opts: Partial<FoundryClientOptions> = {
      onToken: (_text: string) => {},
    };
    expect(typeof opts.onToken).toBe('function');
  });

  it('accepts undefined onToken (non-streaming, default path)', () => {
    const opts: Partial<FoundryClientOptions> = {};
    expect(opts.onToken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SSE streaming — OpenRouter path (stream: true activated by onToken)
// ---------------------------------------------------------------------------

function buildSseBody(chunks: Array<Record<string, unknown>>, closeDone = true): string {
  const lines = chunks.map(c => `data: ${JSON.stringify(c)}`);
  if (closeDone) lines.push('data: [DONE]');
  return lines.join('\n') + '\n';
}

describe('foundryClient streaming via onToken (OpenRouter path)', () => {
  it('calls onToken for each content delta and returns full concatenated content', async () => {
    vi.resetModules();
    process.env['MicrosoftAppId'] = 'test-app-id';
    process.env['MicrosoftAppTenantId'] = 'test-tenant-id';
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    process.env['LLM_PROVIDER'] = 'openrouter';

    const module = await import('../../src/llm/foundryClient.js');

    const ssePayload = buildSseBody([
      { id: 'sse-1', model: 'x-ai/grok-4.1-fast', created: 100, choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }] },
      { id: 'sse-1', model: 'x-ai/grok-4.1-fast', created: 100, choices: [{ index: 0, delta: { content: ', world' }, finish_reason: null }] },
      { id: 'sse-1', model: 'x-ai/grok-4.1-fast', created: 100, choices: [{ index: 0, delta: { content: '!' }, finish_reason: 'stop' }] },
      { id: 'sse-1', model: 'x-ai/grok-4.1-fast', created: 100, choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } },
    ]);

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
      req.setTimeout = (_ms, _cb) => {};
      req.write = (_c) => {};
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
          res.emit('data', Buffer.from(ssePayload));
          res.emit('end');
        });
      };
      return req;
    }) as never;

    module._setRequester(fakeRequester);

    const client = new module.FoundryClient({
      lane: {
        primary: 'x-ai/grok-4.1-fast',
        secondary: 'x-ai/grok-4.1-fast',
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

    const tokensCollected: string[] = [];
    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      correlationId: 'corr-stream-test',
      onToken: (text) => tokensCollected.push(text),
    });

    // onToken was called once per content delta
    expect(tokensCollected).toEqual(['Hello', ', world', '!']);
    // Reconstructed content
    expect(response.choices[0]?.message.content).toBe('Hello, world!');
    // finish_reason preserved
    expect(response.choices[0]?.finishReason).toBe('stop');
    // Token counts from usage chunk
    expect(response.usage.promptTokens).toBe(10);
    expect(response.usage.completionTokens).toBe(3);
    expect(response.usage.totalTokens).toBe(13);
  });

  it('handles streaming tool_calls accumulation across deltas', async () => {
    vi.resetModules();
    process.env['MicrosoftAppId'] = 'test-app-id';
    process.env['MicrosoftAppTenantId'] = 'test-tenant-id';
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    process.env['LLM_PROVIDER'] = 'openrouter';

    const module = await import('../../src/llm/foundryClient.js');

    const ssePayload = buildSseBody([
      // First delta: tool call header
      { id: 'sse-2', model: 'x-ai/grok-4.1-fast', created: 200,
        choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'tc-1', type: 'function', function: { name: 'web_search', arguments: '' } }] }, finish_reason: null }] },
      // Argument fragments
      { id: 'sse-2', model: 'x-ai/grok-4.1-fast', created: 200,
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] }, finish_reason: null }] },
      { id: 'sse-2', model: 'x-ai/grok-4.1-fast', created: 200,
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }] }, finish_reason: 'tool_calls' }] },
      { id: 'sse-2', model: 'x-ai/grok-4.1-fast', created: 200, choices: [], usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 } },
    ]);

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
      req.setTimeout = (_ms, _cb) => {};
      req.write = (_c) => {};
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
          res.emit('data', Buffer.from(ssePayload));
          res.emit('end');
        });
      };
      return req;
    }) as never;

    module._setRequester(fakeRequester);

    const client = new module.FoundryClient({
      lane: {
        primary: 'x-ai/grok-4.1-fast',
        secondary: 'x-ai/grok-4.1-fast',
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

    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'search for hello' }],
      correlationId: 'corr-stream-tools',
      onToken: () => {},
    });

    // Tool call reconstructed from fragments
    const toolCalls = response.choices[0]?.message.toolCalls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls?.[0]?.function.name).toBe('web_search');
    expect(toolCalls?.[0]?.function.arguments).toBe('{"query":"hello"}');
    expect(toolCalls?.[0]?.id).toBe('tc-1');
    expect(response.choices[0]?.finishReason).toBe('tool_calls');
    expect(response.usage.totalTokens).toBe(13);
  });

  it('falls through to non-streaming JSON parse when onToken is undefined', async () => {
    vi.resetModules();
    process.env['MicrosoftAppId'] = 'test-app-id';
    process.env['MicrosoftAppTenantId'] = 'test-tenant-id';
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    process.env['LLM_PROVIDER'] = 'openrouter';

    const module = await import('../../src/llm/foundryClient.js');

    // Normal non-streaming JSON response
    const normalResponse = {
      id: 'resp-normal',
      model: 'x-ai/grok-4.1-fast',
      created: 300,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Non-streaming result' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    };

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
      req.setTimeout = (_ms, _cb) => {};
      req.write = (_c) => {};
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
          res.emit('data', Buffer.from(JSON.stringify(normalResponse)));
          res.emit('end');
        });
      };
      return req;
    }) as never;

    module._setRequester(fakeRequester);

    const client = new module.FoundryClient({
      lane: {
        primary: 'x-ai/grok-4.1-fast',
        secondary: 'x-ai/grok-4.1-fast',
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

    // No onToken → normal non-streaming path
    const response = await client.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      correlationId: 'corr-no-stream',
    });

    expect(response.choices[0]?.message.content).toBe('Non-streaming result');
    expect(response.usage.totalTokens).toBe(10);
  });
});
