import { describe, expect, it } from 'vitest';
import {
  buildModelOverrideDisclosure,
  doesActualModelSatisfyRequestedOverride,
  estimateCostEur,
  formatTelemetryFooter,
  type TurnTelemetryData,
} from '../../src/orchestrator/turnTelemetry.js';

const baseTelemetry: TurnTelemetryData = {
  correlationId: 'abcdef12-3456-7890-abcd-ef1234567890',
  totalMs: 2300,
  model: 'grok-4-1-fast-non-reasoning',
  promptTokens: 1820,
  completionTokens: 512,
  spans: [],
  toolCalls: [],
  safetyPassed: true,
};

describe('turnTelemetry model override disclosure', () => {
  it('accepts exact match', () => {
    expect(doesActualModelSatisfyRequestedOverride('DeepSeek-V3.2', 'DeepSeek-V3.2')).toBe(true);
  });

  it('accepts version-suffixed actual model names', () => {
    expect(doesActualModelSatisfyRequestedOverride('o4-mini', 'o4-mini-2026-03-17')).toBe(true);
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
    expect(buildModelOverrideDisclosure('o4-mini', 'o4-mini-2026-03-17')).toBe('');
  });
});

describe('estimateCostEur', () => {
  it('returns cost for a known model', () => {
    // grok-4-1-fast-non-reasoning: 4 EUR/M tokens, 2332 tokens → 0.009328
    const cost = estimateCostEur('grok-4-1-fast-non-reasoning', 2332);
    expect(cost).toBeCloseTo(0.009328, 5);
  });

  it('matches versioned deployment names via prefix', () => {
    const cost = estimateCostEur('o4-mini-2026-03-17', 1_000_000);
    expect(cost).toBeCloseTo(1.80, 2);
  });

  it('returns undefined for unknown models', () => {
    expect(estimateCostEur('some-custom-model', 1000)).toBeUndefined();
  });
});

describe('formatTelemetryFooter', () => {
  it('returns correlation ID even in off mode', () => {
    const result = formatTelemetryFooter('off', baseTelemetry);
    expect(result).toContain('corr:abcdef12');
    expect(result).not.toContain('E2E');
  });

  it('minimal mode includes cost and uptime', () => {
    const result = formatTelemetryFooter('minimal', baseTelemetry);
    expect(result).toContain('E2E:2300ms');
    expect(result).toContain('m:grok-4.1f');
    expect(result).toContain('$');
    expect(result).toContain('🕐');
    expect(result).toContain('corr:abcdef12');
  });

  it('standard mode includes tokens, tools count, cost, uptime, and correlation', () => {
    const result = formatTelemetryFooter('standard', baseTelemetry);
    expect(result).toContain('pt:1820');
    expect(result).toContain('ct:512');
    expect(result).toContain('tools:0');
    expect(result).toContain('$');
    expect(result).toContain('corr:abcdef12');
  });

  it('standard mode includes sub-agent, token mint, and plan details when present', () => {
    const result = formatTelemetryFooter('standard', {
      ...baseTelemetry,
      subAgentCount: 2,
      scopedTokenMintCount: 3,
      planComplexity: 'complex',
    });
    expect(result).toContain('sa:2');
    expect(result).toContain('tok:3');
    expect(result).toContain('plan:complex');
  });

  it('verbose mode includes safety and tool names', () => {
    const data: TurnTelemetryData = {
      ...baseTelemetry,
      toolCalls: ['outlook_list_messages', 'github_search_repos'],
      modelSequence: ['grok-4-1-fast-non-reasoning', 'o4-mini'],
    };
    const result = formatTelemetryFooter('verbose', data);
    expect(result).toContain('safe:✓');
    expect(result).toContain('outlook_list_messages');
    expect(result).toContain('github_search_repos');
    expect(result).toContain('models:grok-4.1f→o4m');
    expect(result).toContain('$');
    expect(result).toContain('corr:abcdef12');
  });

  it('verbose mode includes scoped token count when present', () => {
    const data: TurnTelemetryData = {
      ...baseTelemetry,
      toolCalls: ['outlook_send_email'],
      subAgentCount: 1,
      scopedTokenMintCount: 1,
      planComplexity: 'compound',
    };
    const result = formatTelemetryFooter('verbose', data);
    expect(result).toContain('sa:1');
    expect(result).toContain('tok:1');
    expect(result).toContain('plan:compound');
  });
});

