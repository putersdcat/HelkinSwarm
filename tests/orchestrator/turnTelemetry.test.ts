import { describe, expect, it } from 'vitest';
import {
  buildModelOverrideDisclosure,
  doesActualModelSatisfyRequestedOverride,
  estimateCostEur,
  formatTelemetryFooter,
  type TurnTelemetryData,
  type SwarmAgentTelemetry,
} from '../../src/orchestrator/turnTelemetry.js';

const baseTelemetry: TurnTelemetryData = {
  correlationId: 'abcdef12-3456-7890-abcd-ef1234567890',
  timestampIso: '2026-04-09T06:24:43.570Z',
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
    expect(cost).toBeCloseTo(2.40, 2);
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
    expect(result).toContain('ts:2026-04-09T06:24:43Z');
    expect(result).toContain('$');
    expect(result).toContain('🕐');
    expect(result).toContain('corr:abcdef12');
  });

  it('standard mode includes tokens, tools count, cost, uptime, and correlation', () => {
    const result = formatTelemetryFooter('standard', baseTelemetry);
    expect(result).toContain('pt:1820');
    expect(result).toContain('ct:512');
    expect(result).toContain('tools:0');
    expect(result).toContain('ts:2026-04-09T06:24:43Z');
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
    expect(result).toContain('ts:2026-04-09T06:24:43Z');
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

  it('verbose mode still shows an explicit zero-tool indicator when no tools were called', () => {
    const result = formatTelemetryFooter('verbose', baseTelemetry);
    expect(result).toContain('tools:0');
  });

  it('prefers exact provider-reported OpenRouter credits over model-cost estimation when present', () => {
    const result = formatTelemetryFooter('verbose', {
      ...baseTelemetry,
      model: 'x-ai/grok-4.1-fast',
      providerCost: 0.95,
      providerCostUnit: 'credits',
      providerCostDetails: {
        upstream_inference_cost: 19,
      },
    });

    expect(result).toContain('0.9500cr');
    expect(result).toContain('up:19.0000cr');
    expect(result).not.toContain('$?');
  });
});

// Swarm per-agent telemetry footer tests (#636)
const swarmAgentBreakdown: SwarmAgentTelemetry[] = [
  { agent: 'Alpha', tokens: 2100, durationMs: 12000, toolCalls: 3, success: true },
  { agent: 'Beta', tokens: 1800, durationMs: 8000, toolCalls: 2, success: true },
  { agent: 'Gamma', tokens: 500, durationMs: 3000, toolCalls: 0, success: false },
];

const swarmTelemetry: TurnTelemetryData = {
  ...baseTelemetry,
  model: 'swarm:grok-4-1-fast-non-reasoning',
  completionTokens: 5300,
  subAgentCount: 3,
  planComplexity: 'complex',
  decomposerTokens: 320,
  leaderTokens: 900,
  swarmAgentBreakdown,
};

describe('formatTelemetryFooter — swarm per-agent breakdown (#636)', () => {
  it('verbose mode shows decomposer tokens separately', () => {
    const result = formatTelemetryFooter('verbose', swarmTelemetry);
    expect(result).toContain('decomp:320t');
  });

  it('verbose mode shows per-agent tokens, duration, tool count, and success', () => {
    const result = formatTelemetryFooter('verbose', swarmTelemetry);
    expect(result).toContain('Alpha:2100t(12s,3tools✓)');
    expect(result).toContain('Beta:1800t(8s,2tools✓)');
    expect(result).toContain('Gamma:500t(3s,0tools✗)');
  });

  it('verbose mode shows leader tokens separately', () => {
    const result = formatTelemetryFooter('verbose', swarmTelemetry);
    expect(result).toContain('leader:900t');
  });

  it('standard mode shows worker-total and leader-total split', () => {
    const result = formatTelemetryFooter('standard', swarmTelemetry);
    // Worker total = 2100 + 1800 + 500 = 4400
    expect(result).toContain('workers:4400t');
    expect(result).toContain('leader:900t');
    expect(result).toContain('decomp:320t');
  });

  it('standard mode shows agent count', () => {
    const result = formatTelemetryFooter('standard', swarmTelemetry);
    expect(result).toContain('sa:3');
  });

  it('minimal mode does not include per-agent breakdown', () => {
    const result = formatTelemetryFooter('minimal', swarmTelemetry);
    expect(result).not.toContain('Alpha');
    expect(result).not.toContain('decomp');
    expect(result).not.toContain('leader:');
    expect(result).toContain('E2E:');
  });

  it('verbose mode orders: decomposer → agents → leader', () => {
    const result = formatTelemetryFooter('verbose', swarmTelemetry);
    const decompIdx = result.indexOf('decomp:320t');
    const alphaIdx = result.indexOf('Alpha:');
    const leaderIdx = result.indexOf('leader:900t');
    expect(decompIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(leaderIdx);
  });

  it('non-swarm turns do not include swarm fields', () => {
    const result = formatTelemetryFooter('verbose', baseTelemetry);
    expect(result).not.toContain('decomp');
    expect(result).not.toContain('leader:');
    expect(result).not.toContain('Alpha');
  });
});

describe('formatTelemetryFooter — web search requests (#650 AC-3)', () => {
  it('standard mode shows web search count when present', () => {
    const result = formatTelemetryFooter('standard', {
      ...baseTelemetry,
      webSearchRequests: 2,
    });
    expect(result).toContain('web:2');
  });

  it('verbose mode shows web search count when present', () => {
    const result = formatTelemetryFooter('verbose', {
      ...baseTelemetry,
      webSearchRequests: 3,
    });
    expect(result).toContain('web:3');
  });

  it('omits web search indicator when webSearchRequests is zero or absent', () => {
    const resultAbsent = formatTelemetryFooter('verbose', baseTelemetry);
    expect(resultAbsent).not.toContain('web:');

    const resultZero = formatTelemetryFooter('verbose', {
      ...baseTelemetry,
      webSearchRequests: 0,
    });
    expect(resultZero).not.toContain('web:');
  });

  it('minimal mode does not include web search count', () => {
    const result = formatTelemetryFooter('minimal', {
      ...baseTelemetry,
      webSearchRequests: 5,
    });
    expect(result).not.toContain('web:');
  });
});

describe('formatTelemetryFooter — web search requests (#650 AC-3)', () => {
  it('standard mode shows web search count when present', () => {
    const result = formatTelemetryFooter('standard', {
      ...baseTelemetry,
      webSearchRequests: 2,
    });
    expect(result).toContain('web:2');
  });

  it('verbose mode shows web search count when present', () => {
    const result = formatTelemetryFooter('verbose', {
      ...baseTelemetry,
      webSearchRequests: 3,
    });
    expect(result).toContain('web:3');
  });

  it('omits web search indicator when webSearchRequests is zero or absent', () => {
    const resultAbsent = formatTelemetryFooter('verbose', baseTelemetry);
    expect(resultAbsent).not.toContain('web:');

    const resultZero = formatTelemetryFooter('verbose', {
      ...baseTelemetry,
      webSearchRequests: 0,
    });
    expect(resultZero).not.toContain('web:');
  });

  it('minimal mode does not include web search count', () => {
    const result = formatTelemetryFooter('minimal', {
      ...baseTelemetry,
      webSearchRequests: 5,
    });
    expect(result).not.toContain('web:');
  });
});