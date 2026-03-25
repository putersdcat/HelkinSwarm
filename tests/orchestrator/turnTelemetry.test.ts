import { describe, expect, it } from 'vitest';
import {
  buildModelOverrideDisclosure,
  doesActualModelSatisfyRequestedOverride,
} from '../../src/orchestrator/turnTelemetry.js';

describe('turnTelemetry model override disclosure', () => {
  it('accepts exact match', () => {
    expect(doesActualModelSatisfyRequestedOverride('DeepSeek-V3.2', 'DeepSeek-V3.2')).toBe(true);
  });

  it('accepts version-suffixed actual model names', () => {
    expect(doesActualModelSatisfyRequestedOverride('gpt-5.4-mini', 'gpt-5.4-mini-2026-03-17')).toBe(true);
  });

  it('rejects fallback to a different model', () => {
    expect(doesActualModelSatisfyRequestedOverride('DeepSeek-V3.2', 'grok-4-1-fast-non-reasoning')).toBe(false);
  });

  it('builds a disclosure when the turn completed on another model', () => {
    const disclosure = buildModelOverrideDisclosure('FW-Kimi-K2.5', 'grok-4-1-fast-non-reasoning');
    expect(disclosure).toContain('Requested `FW-Kimi-K2.5`');
    expect(disclosure).toContain('completed on `grok-4-1-fast-non-reasoning`');
    expect(disclosure).toContain('fallback');
  });

  it('does not build a disclosure when the requested model was honored', () => {
    expect(buildModelOverrideDisclosure('o4-mini', 'o4-mini')).toBe('');
    expect(buildModelOverrideDisclosure('gpt-5.4-mini', 'gpt-5.4-mini-2026-03-17')).toBe('');
  });
});