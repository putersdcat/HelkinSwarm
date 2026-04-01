import { describe, expect, it } from 'vitest';
import {
  buildCostComparisonSummary,
  type CostPeriodSummary,
} from '../../src/integrations/azureCostManagement.js';

function buildSuccessfulPeriod(overrides: Partial<Extract<CostPeriodSummary, { status: 'success' }>> = {}): Extract<CostPeriodSummary, { status: 'success' }> {
  return {
    status: 'success',
    label: 'Current month',
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    daysInMonth: 31,
    currency: 'USD',
    totalCost: 0,
    breakdown: [],
    daily: [],
    validDayCount: 0,
    ...overrides,
  };
}

describe('buildCostComparisonSummary', () => {
  it('aligns previous month to the current reporting day and normalizes velocity by reported days', () => {
    const currentMonth = buildSuccessfulPeriod({
      totalCost: 30,
      daily: [
        { date: '2026-03-01', cost: 10 },
        { date: '2026-03-02', cost: 5 },
        { date: '2026-03-04', cost: 7 },
        { date: '2026-03-31', cost: 8 },
      ],
      validDayCount: 4,
      lastReportedDate: '2026-03-31',
    });
    const previousMonth = buildSuccessfulPeriod({
      label: 'Previous month',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      daysInMonth: 28,
      totalCost: 20,
      daily: [
        { date: '2026-02-01', cost: 4 },
        { date: '2026-02-02', cost: 6 },
        { date: '2026-02-28', cost: 10 },
      ],
      validDayCount: 3,
      lastReportedDate: '2026-02-28',
    });

    const comparison = buildCostComparisonSummary(currentMonth, previousMonth);
    expect(comparison.status).toBe('available');

    if (comparison.status !== 'available') {
      throw new Error('Expected available comparison summary');
    }

    expect(comparison.compareThroughDay).toBe(31);
    expect(comparison.alignedPreviousDay).toBe(28);
    expect(comparison.currentWindowCost).toBe(30);
    expect(comparison.previousWindowCost).toBe(20);
    expect(comparison.spendDelta).toBe(10);
    expect(comparison.spendDeltaPercent).toBe(50);
    expect(comparison.currentVelocity).toBe(7.5);
    expect(comparison.previousVelocity).toBe(6.67);
    expect(comparison.projectedMonthEndCost).toBe(232.5);
    expect(comparison.previousProjectedMonthEndCost).toBe(186.76);
    expect(comparison.assumptions).toContainEqual(expect.stringContaining('fewer calendar days'));
    expect(comparison.assumptions).toContainEqual(expect.stringContaining('Current month is missing'));
    expect(comparison.assumptions).toContainEqual(expect.stringContaining('Previous month is missing'));
  });

  it('returns an honest unavailable result when previous month data is missing', () => {
    const currentMonth = buildSuccessfulPeriod({
      totalCost: 12,
      daily: [
        { date: '2026-03-01', cost: 5 },
        { date: '2026-03-02', cost: 7 },
      ],
      validDayCount: 2,
      lastReportedDate: '2026-03-02',
    });
    const previousMonth: CostPeriodSummary = {
      status: 'unavailable',
      label: 'Previous month',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      daysInMonth: 28,
      currency: 'USD',
      totalCost: 0,
      breakdown: [],
      daily: [],
      validDayCount: 0,
      message: 'Previous month data has not landed yet.',
    };

    const comparison = buildCostComparisonSummary(currentMonth, previousMonth);
    expect(comparison.status).toBe('unavailable');

    if (comparison.status !== 'unavailable') {
      throw new Error('Expected unavailable comparison summary');
    }

    expect(comparison.compareThroughDay).toBe(2);
    expect(comparison.message).toContain('Previous month data has not landed yet');
    expect(comparison.fallbackSuggestion).toContain('year-to-date');
  });
});