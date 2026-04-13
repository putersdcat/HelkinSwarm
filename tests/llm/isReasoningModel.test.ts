// Tests for the isReasoningModel() helper — ensures non-reasoning variants
// are not misclassified as reasoning models.
// Issue: #631, #632

import { describe, expect, it } from 'vitest';
import { isReasoningModel } from '../../src/llm/modelRouter.js';

describe('isReasoningModel', () => {
  it('returns false for grok-4-1-fast-non-reasoning', () => {
    expect(isReasoningModel('grok-4-1-fast-non-reasoning')).toBe(false);
  });

  it('returns true for grok-4-1-fast-reasoning', () => {
    expect(isReasoningModel('grok-4-1-fast-reasoning')).toBe(true);
  });

  it('returns true for o4-mini', () => {
    expect(isReasoningModel('o4-mini')).toBe(true);
  });

  it('returns true for o-series models', () => {
    expect(isReasoningModel('o3-mini')).toBe(true);
    expect(isReasoningModel('o1-preview')).toBe(true);
  });

  it('returns false for non-reasoning models without the keyword', () => {
    expect(isReasoningModel('gpt-4o')).toBe(false);
    expect(isReasoningModel('text-embedding-3-large')).toBe(false);
  });

  it('returns false for models with non-reasoning suffix', () => {
    expect(isReasoningModel('custom-non-reasoning-fast')).toBe(false);
  });
});
