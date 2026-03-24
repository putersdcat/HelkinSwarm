import { describe, expect, it } from 'vitest';
import { needsNewTokenParam } from '../../src/llm/foundryClient.js';
import {
  getDirectChatModelIncompatibilityReason,
  getSupportedDirectChatModelOverrides,
  isDirectChatModelOverrideSupported,
} from '../../src/llm/modelRouter.js';

describe('needsNewTokenParam', () => {
  it('uses max_completion_tokens for GPT-5 family models', () => {
    expect(needsNewTokenParam('gpt-5.4-mini')).toBe(true);
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

  it('keeps gpt-5.4-mini available for direct chat override', () => {
    expect(isDirectChatModelOverrideSupported('gpt-5.4-mini')).toBe(true);
    expect(getDirectChatModelIncompatibilityReason('gpt-5.4-mini')).toBeUndefined();
  });
});