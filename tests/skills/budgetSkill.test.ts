// Budget skill tests — unit tests for budget_get_status and budget_estimate_tokens.
// Issue: #242

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// budget_estimate_tokens (pure logic — no mocks needed)
// ---------------------------------------------------------------------------

describe('budget_estimate_tokens', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['LLM_PRIMARY_MODEL'] = 'x-ai/grok-4.1-fast';
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env['LLM_PRIMARY_MODEL'];
  });

  it('estimates tokens and turns for $10 at blended grok-4.1-fast rate', async () => {
    const { budget_estimate_tokens } = await import('../../skills/budget/handlers.js');
    const result = await budget_estimate_tokens({ usd_budget: 10 }) as {
      status: string;
      model: string;
      estimated_total_tokens: number;
      estimated_turns: number;
      rate_per_million_tokens: number;
      mode: string;
    };

    expect(result.status).toBe('success');
    expect(result.model).toBe('x-ai/grok-4.1-fast');
    expect(result.mode).toBe('blended');
    // $10 / $4.00 per M tokens = 2.5M tokens
    expect(result.estimated_total_tokens).toBe(2_500_000);
    // 2.5M / 2500 per turn = 1000 turns
    expect(result.estimated_turns).toBe(1000);
    expect(result.rate_per_million_tokens).toBe(4.00);
  });

  it('respects explicit model override', async () => {
    const { budget_estimate_tokens } = await import('../../skills/budget/handlers.js');
    const result = await budget_estimate_tokens({
      usd_budget: 1,
      model: 'o4-mini',
    }) as { status: string; model: string; rate_per_million_tokens: number };

    expect(result.status).toBe('success');
    expect(result.model).toBe('o4-mini');
    expect(result.rate_per_million_tokens).toBe(2.40);
  });

  it('respects input mode vs blended mode', async () => {
    const { budget_estimate_tokens } = await import('../../skills/budget/handlers.js');

    const blended = await budget_estimate_tokens({ usd_budget: 1 }) as {
      rate_per_million_tokens: number;
    };
    const input = await budget_estimate_tokens({ usd_budget: 1, mode: 'input' }) as {
      rate_per_million_tokens: number;
    };

    // grok-4.1-fast: blended=$4.00, input=$3.00
    expect(blended.rate_per_million_tokens).toBe(4.00);
    expect(input.rate_per_million_tokens).toBe(3.00);
    // input mode gives more tokens per dollar
    const blendedTokens = (blended as { estimated_total_tokens: number }).estimated_total_tokens;
    const inputTokens = (input as { estimated_total_tokens: number }).estimated_total_tokens;
    expect(inputTokens).toBeGreaterThan(blendedTokens);
  });

  it('returns unknown_model for unrecognised model name', async () => {
    const { budget_estimate_tokens } = await import('../../skills/budget/handlers.js');
    const result = await budget_estimate_tokens({
      usd_budget: 5,
      model: 'nonexistent-model-xyz',
    }) as { status: string; message: string };

    expect(result.status).toBe('unknown_model');
    expect(result.message).toContain('No rate data found');
  });

  it('validates that usd_budget must be positive', async () => {
    const { budget_estimate_tokens } = await import('../../skills/budget/handlers.js');
    await expect(
      budget_estimate_tokens({ usd_budget: -5 }),
    ).rejects.toThrow();
  });

  it('falls back to LLM_PRIMARY_MODEL env var when model not specified', async () => {
    process.env['LLM_PRIMARY_MODEL'] = 'o4-mini';
    vi.resetModules();
    const { budget_estimate_tokens } = await import('../../skills/budget/handlers.js');
    const result = await budget_estimate_tokens({ usd_budget: 1 }) as {
      status: string;
      model: string;
    };

    expect(result.status).toBe('success');
    expect(result.model).toBe('o4-mini');
  });

  it('handles partial model name matching (grok partial)', async () => {
    const { budget_estimate_tokens } = await import('../../skills/budget/handlers.js');
    const result = await budget_estimate_tokens({
      usd_budget: 1,
      model: 'grok-4-1-fast-reasoning',
    }) as { status: string; rate_per_million_tokens: number };

    expect(result.status).toBe('success');
    expect(result.rate_per_million_tokens).toBe(12.00);
  });
});

// ---------------------------------------------------------------------------
// budget_get_status (mocked Azure integration)
// ---------------------------------------------------------------------------

describe('budget_get_status', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['LLM_PRIMARY_MODEL'] = 'x-ai/grok-4.1-fast';
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env['LLM_PRIMARY_MODEL'];
  });

  it('returns status=success with spend data when Azure reports success', async () => {
    vi.doMock('../../src/integrations/azureCostManagement.js', () => ({
      getAzureResourceGroupCostSummary: async () => ({
        status: 'success',
        period: 'MonthToDate',
        resourceGroup: 'rg-helkinswarm-a7f2',
        currency: 'USD',
        totalCost: 18.42,
        breakdown: [{ service: 'Container Apps', cost: 12.00 }],
        daily: [{ date: '2026-04-10', cost: 0.62 }],
        currentMonth: {
          status: 'success',
          label: 'April 2026',
          daysInMonth: 30,
          periodStart: '2026-04-01',
          periodEnd: '2026-04-30',
          currency: 'USD',
          totalCost: 18.42,
          breakdown: [],
          daily: [],
          validDayCount: 10,
        },
        previousMonth: {
          status: 'success',
          label: 'March 2026',
          daysInMonth: 31,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          currency: 'USD',
          totalCost: 21.00,
          breakdown: [],
          daily: [],
          validDayCount: 31,
        },
        comparison: {
          status: 'available',
          compareThroughDay: 10,
          alignedPreviousDay: 10,
          currentWindowCost: 18.42,
          previousWindowCost: 6.77,
          spendDelta: 11.65,
          spendDeltaPercent: 172,
          currentVelocity: 1.84,
          previousVelocity: 0.22,
          projectedMonthEndCost: 55.26,
          previousProjectedMonthEndCost: 6.84,
          assumptions: [],
        },
      }),
    }));

    const { budget_get_status } = await import('../../skills/budget/handlers.js');
    const result = await budget_get_status({}) as {
      status: string;
      currentMonthSpend: number;
      currency: string;
      dailyVelocity: number;
      projectedMonthEnd: number;
      previousMonthTotal: number;
      primaryModel: string;
      primaryModelRateUsdPerMTokens: { blended: number };
    };

    expect(result.status).toBe('success');
    expect(result.currentMonthSpend).toBe(18.42);
    expect(result.currency).toBe('USD');
    expect(result.dailyVelocity).toBe(1.84);
    expect(result.projectedMonthEnd).toBe(55.26);
    expect(result.previousMonthTotal).toBe(21.00);
    expect(result.primaryModel).toBe('x-ai/grok-4.1-fast');
    expect(result.primaryModelRateUsdPerMTokens?.blended).toBe(4.00);
  });

  it('passes through error status when Azure integration fails', async () => {
    vi.doMock('../../src/integrations/azureCostManagement.js', () => ({
      getAzureResourceGroupCostSummary: async () => ({
        status: 'unavailable',
        message: 'Azure Cost Management is unavailable.',
      }),
    }));

    const { budget_get_status } = await import('../../skills/budget/handlers.js');
    const result = await budget_get_status({}) as { status: string; message: string };

    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('unavailable');
  });

  it('returns null primaryModelRateUsdPerMTokens for unknown env model', async () => {
    process.env['LLM_PRIMARY_MODEL'] = 'totally-unknown-model-99';
    vi.resetModules();

    vi.doMock('../../src/integrations/azureCostManagement.js', () => ({
      getAzureResourceGroupCostSummary: async () => ({
        status: 'success',
        period: 'MonthToDate',
        resourceGroup: 'rg-test',
        currency: 'USD',
        totalCost: 5.00,
        breakdown: [],
        daily: [],
        currentMonth: {
          status: 'success',
          label: 'April 2026',
          daysInMonth: 30,
          periodStart: '2026-04-01',
          periodEnd: '2026-04-30',
          currency: 'USD',
          totalCost: 5.00,
          breakdown: [],
          daily: [],
          validDayCount: 5,
        },
        previousMonth: {
          status: 'success',
          label: 'March 2026',
          daysInMonth: 31,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          currency: 'USD',
          totalCost: 10.00,
          breakdown: [],
          daily: [],
          validDayCount: 31,
        },
        comparison: {
          status: 'available',
          compareThroughDay: 5,
          alignedPreviousDay: 5,
          currentWindowCost: 5.00,
          previousWindowCost: 1.61,
          spendDelta: 3.39,
          spendDeltaPercent: 210,
          currentVelocity: 1.00,
          previousVelocity: 0.32,
          projectedMonthEndCost: 30.00,
          previousProjectedMonthEndCost: 10.00,
          assumptions: [],
        },
      }),
    }));

    const { budget_get_status } = await import('../../skills/budget/handlers.js');
    const result = await budget_get_status({}) as {
      status: string;
      primaryModelRateUsdPerMTokens: null;
    };

    expect(result.status).toBe('success');
    expect(result.primaryModelRateUsdPerMTokens).toBeNull();
  });
});
