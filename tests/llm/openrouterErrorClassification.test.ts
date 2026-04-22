import { describe, expect, it } from 'vitest';
import {
  classifyOpenRouterStatus,
  detectOpenRouterEmptyCompletion,
  FoundryError,
  type OpenRouterErrorClass,
} from '../../src/llm/foundryClient.js';
import type { ChatCompletionResponse } from '../../src/llm/foundryClient.js';

describe('classifyOpenRouterStatus (#677)', () => {
  const cases: Array<[number, OpenRouterErrorClass]> = [
    [400, 'validation'],
    [401, 'auth'],
    [402, 'credits'],
    [403, 'auth'],
    [408, 'upstream_timeout'],
    [422, 'validation'],
    [429, 'rate_limit'],
    [500, 'server_error'],
    [502, 'upstream_down'],
    [503, 'upstream_down'],
    [504, 'upstream_timeout'],
    [524, 'upstream_timeout'],
    [418, 'unknown'],
  ];

  for (const [status, expected] of cases) {
    it(`maps status ${status} -> ${expected}`, () => {
      expect(classifyOpenRouterStatus(status)).toBe(expected);
    });
  }
});

describe('FoundryError errorClass (#677)', () => {
  it('auto-derives errorClass from statusCode when not supplied', () => {
    const err = new FoundryError('boom', 429, 'x-ai/grok-4.1-fast');
    expect(err.errorClass).toBe('rate_limit');
  });

  it('honours explicit errorClass override (e.g. empty_response on 422)', () => {
    const err = new FoundryError('blank', 422, 'x-ai/grok-4.1-fast', undefined, 'empty_response');
    expect(err.errorClass).toBe('empty_response');
    expect(err.statusCode).toBe(422);
  });
});

function makeResponse(overrides: {
  completionTokens?: number;
  content?: string;
  toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  finishReason?: ChatCompletionResponse['choices'][number]['finishReason'];
}): ChatCompletionResponse {
  return {
    id: 'chatcmpl-test',
    model: 'x-ai/grok-4.1-fast',
    created: 0,
    usage: {
      promptTokens: 100,
      completionTokens: overrides.completionTokens ?? 0,
      totalTokens: 100 + (overrides.completionTokens ?? 0),
    },
    choices: [{
      index: 0,
      finishReason: overrides.finishReason ?? 'stop',
      message: {
        role: 'assistant',
        content: overrides.content ?? '',
        toolCalls: overrides.toolCalls,
      },
    }],
  };
}

describe('detectOpenRouterEmptyCompletion (#677)', () => {
  it('throws empty_response when 0 tokens + 0 tools + 0 content', () => {
    expect(() => detectOpenRouterEmptyCompletion(makeResponse({}), 'x-ai/grok-4.1-fast'))
      .toThrowError(FoundryError);
    try {
      detectOpenRouterEmptyCompletion(makeResponse({}), 'x-ai/grok-4.1-fast');
    } catch (err) {
      expect(err).toBeInstanceOf(FoundryError);
      expect((err as FoundryError).errorClass).toBe('empty_response');
      expect((err as FoundryError).statusCode).toBe(422);
    }
  });

  it('passes when content is present', () => {
    expect(() => detectOpenRouterEmptyCompletion(
      makeResponse({ completionTokens: 5, content: 'hello' }),
      'x-ai/grok-4.1-fast',
    )).not.toThrow();
  });

  it('passes when only whitespace content but tokens reported (allow normal flow)', () => {
    // completionTokens > 0 means upstream produced something — let it through.
    expect(() => detectOpenRouterEmptyCompletion(
      makeResponse({ completionTokens: 1, content: '   ' }),
      'x-ai/grok-4.1-fast',
    )).not.toThrow();
  });

  it('passes when tool calls are present even if content is empty', () => {
    expect(() => detectOpenRouterEmptyCompletion(
      makeResponse({
        toolCalls: [{ id: 't1', type: 'function', function: { name: 'fx', arguments: '{}' } }],
        finishReason: 'tool_calls',
      }),
      'x-ai/grok-4.1-fast',
    )).not.toThrow();
  });

  it('treats whitespace-only content with 0 tokens as empty', () => {
    expect(() => detectOpenRouterEmptyCompletion(
      makeResponse({ completionTokens: 0, content: '   \n\t  ' }),
      'x-ai/grok-4.1-fast',
    )).toThrowError(FoundryError);
  });
});
