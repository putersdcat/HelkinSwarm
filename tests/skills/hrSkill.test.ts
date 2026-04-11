// HR skill tests — unit tests for hr_generate_owner_report.
// Issue: #245

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Cosmos mock — must be class-based for `new CosmosClient(...)` to work
// ---------------------------------------------------------------------------

const mockFetchAll = vi.fn();
const mockQuery = vi.fn().mockReturnValue({ fetchAll: mockFetchAll });
const mockContainer = { items: { query: mockQuery } };

vi.mock('@azure/cosmos', () => ({
  CosmosClient: class {
    database() { return { container: () => mockContainer }; }
  },
}));

vi.mock('@azure/identity', () => ({
  ManagedIdentityCredential: class {},
  DefaultAzureCredential: class {},
}));

// ---------------------------------------------------------------------------
// Azure Cost Management mock
// ---------------------------------------------------------------------------

const mockGetCostSummary = vi.fn();

vi.mock('../../src/integrations/azureCostManagement.js', () => ({
  getAzureResourceGroupCostSummary: mockGetCostSummary,
}));

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const SUCCESS_COST_SUMMARY = {
  status: 'success' as const,
  period: 'MonthToDate' as const,
  resourceGroup: 'rg-helkinswarm-a7f2',
  currency: 'USD',
  totalCost: 59.11,
  breakdown: [],
  daily: [],
  currentMonth: {
    status: 'success' as const,
    label: 'April 2026',
    periodStart: '2026-04-01',
    periodEnd: '2026-04-10',
    daysInMonth: 30,
    currency: 'USD',
    totalCost: 59.11,
    breakdown: [],
    daily: [],
    validDayCount: 10,
  },
  previousMonth: {
    status: 'success' as const,
    label: 'March 2026',
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    daysInMonth: 31,
    currency: 'USD',
    totalCost: 113.16,
    breakdown: [],
    daily: [],
    validDayCount: 31,
  },
  comparison: {
    status: 'available' as const,
    compareThroughDay: 10,
    alignedPreviousDay: 10,
    currentWindowCost: 59.11,
    previousWindowCost: 36.0,
    spendDelta: 23.11,
    spendDeltaPercent: 64.2,
    currentVelocity: 5.91,
    previousVelocity: 3.65,
    projectedMonthEndCost: 177.33,
    previousProjectedMonthEndCost: 113.16,
    assumptions: [],
  },
};

// ---------------------------------------------------------------------------
// hr_generate_owner_report
// ---------------------------------------------------------------------------

describe('hr_generate_owner_report', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['COSMOS_ENDPOINT'] = 'https://test.documents.azure.com:443/';
    process.env['AZURE_CLIENT_ID'] = '';
    mockFetchAll.mockReset();
    mockGetCostSummary.mockReset();
  });

  afterEach(() => {
    delete process.env['COSMOS_ENDPOINT'];
    delete process.env['AZURE_CLIENT_ID'];
  });

  it('returns success with full data when both Cosmos and Azure cost respond', async () => {
    mockGetCostSummary.mockResolvedValueOnce(SUCCESS_COST_SUMMARY);
    mockFetchAll.mockResolvedValueOnce({
      resources: [
        { entryType: 'expense', amount: 50.00, currency: 'USD', status: 'confirmed' },
        { entryType: 'revenue', amount: 200.00, currency: 'USD', status: 'confirmed' },
      ],
    });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as {
      status: string;
      period: string;
      summary: {
        azureBurnMtd: number;
        internalRevenue: number;
        internalExpenses: number;
        netBalance: number;
        openInvoiceCount: number;
      };
      report: string;
    };

    expect(result.status).toBe('success');
    expect(result.period).toBe('this-month');
    expect(result.summary.azureBurnMtd).toBe(59.11);
    expect(result.summary.internalRevenue).toBe(200.00);
    expect(result.summary.internalExpenses).toBe(50.00);
    expect(result.summary.netBalance).toBe(150.00);
    expect(result.summary.openInvoiceCount).toBe(0);
    expect(result.report).toContain('Owner Report');
    expect(result.report).toContain('Infrastructure Burn');
    expect(result.report).toContain('Internal Ledger');
    expect(result.report).toContain('+$150.00');
  });

  it('defaults to this-month period when no args provided', async () => {
    mockGetCostSummary.mockResolvedValueOnce(SUCCESS_COST_SUMMARY);
    mockFetchAll.mockResolvedValueOnce({ resources: [] });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as { period: string; periodLabel: string };

    expect(result.period).toBe('this-month');
    expect(result.periodLabel).toContain('This month');
  });

  it('accepts explicit last-month period', async () => {
    mockGetCostSummary.mockResolvedValueOnce(SUCCESS_COST_SUMMARY);
    mockFetchAll.mockResolvedValueOnce({ resources: [] });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({ period: 'last-month' }) as { period: string; periodLabel: string };

    expect(result.period).toBe('last-month');
    expect(result.periodLabel).toContain('Last month');
  });

  it('accepts all-time period', async () => {
    mockGetCostSummary.mockResolvedValueOnce(SUCCESS_COST_SUMMARY);
    mockFetchAll.mockResolvedValueOnce({ resources: [] });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({ period: 'all-time' }) as { period: string; periodLabel: string };

    expect(result.period).toBe('all-time');
    expect(result.periodLabel).toBe('All time');
  });

  it('still returns success when Azure cost API is unavailable', async () => {
    mockGetCostSummary.mockResolvedValueOnce({
      status: 'error',
      message: 'Cost API unavailable',
    });
    mockFetchAll.mockResolvedValueOnce({
      resources: [
        { entryType: 'expense', amount: 100.00, currency: 'USD', status: 'confirmed' },
      ],
    });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as {
      status: string;
      summary: { azureBurnMtd: number | null; internalExpenses: number };
      report: string;
    };

    expect(result.status).toBe('success');
    expect(result.summary.azureBurnMtd).toBeNull();
    expect(result.summary.internalExpenses).toBe(100.00);
    expect(result.report).toContain('Infrastructure cost data unavailable');
  });

  it('still returns success when Azure cost API throws', async () => {
    mockGetCostSummary.mockRejectedValueOnce(new Error('Network error'));
    mockFetchAll.mockResolvedValueOnce({ resources: [] });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as { status: string };

    expect(result.status).toBe('success');
  });

  it('still returns success when Cosmos ledger throws', async () => {
    mockGetCostSummary.mockResolvedValueOnce(SUCCESS_COST_SUMMARY);
    mockFetchAll.mockRejectedValueOnce(new Error('Cosmos error'));

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as {
      status: string;
      summary: { internalRevenue: number; internalExpenses: number };
      report: string;
    };

    expect(result.status).toBe('success');
    expect(result.summary.internalRevenue).toBe(0);
    expect(result.summary.internalExpenses).toBe(0);
    expect(result.report).toContain('Ledger data unavailable');
  });

  it('aggregates expenses correctly (confirmed + draft count, other statuses skip)', async () => {
    mockGetCostSummary.mockResolvedValueOnce({ status: 'error', message: 'n/a' });
    mockFetchAll.mockResolvedValueOnce({
      resources: [
        { entryType: 'expense', amount: 30.00, currency: 'USD', status: 'confirmed' },
        { entryType: 'expense', amount: 20.00, currency: 'USD', status: 'draft' },
        { entryType: 'expense', amount: 10.00, currency: 'USD', status: 'cancelled' }, // skipped
        { entryType: 'expense', amount: 5.00, currency: 'USD', status: 'pending' },   // skipped
      ],
    });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as {
      summary: { internalExpenses: number };
    };

    expect(result.summary.internalExpenses).toBe(50.00); // 30 + 20 only
  });

  it('aggregates revenue correctly (confirmed + paid count)', async () => {
    mockGetCostSummary.mockResolvedValueOnce({ status: 'error', message: 'n/a' });
    mockFetchAll.mockResolvedValueOnce({
      resources: [
        { entryType: 'revenue', amount: 100.00, currency: 'USD', status: 'confirmed' },
        { entryType: 'revenue', amount: 50.00, currency: 'USD', status: 'paid' },
        { entryType: 'revenue', amount: 25.00, currency: 'USD', status: 'pending' },  // skipped
        { entryType: 'revenue', amount: 10.00, currency: 'USD', status: 'cancelled' }, // skipped
      ],
    });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as {
      summary: { internalRevenue: number };
    };

    expect(result.summary.internalRevenue).toBe(150.00); // 100 + 50 only
  });

  it('counts pending invoices as outstanding and paid invoices as revenue', async () => {
    mockGetCostSummary.mockResolvedValueOnce({ status: 'error', message: 'n/a' });
    mockFetchAll.mockResolvedValueOnce({
      resources: [
        { entryType: 'invoice', amount: 500.00, currency: 'USD', status: 'pending' },
        { entryType: 'invoice', amount: 300.00, currency: 'USD', status: 'pending' },
        { entryType: 'invoice', amount: 200.00, currency: 'USD', status: 'paid' }, // counts as revenue
      ],
    });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as {
      summary: {
        openInvoiceCount: number;
        openInvoiceTotal: number;
        internalRevenue: number;
      };
      report: string;
    };

    expect(result.summary.openInvoiceCount).toBe(2);
    expect(result.summary.openInvoiceTotal).toBe(800.00);
    expect(result.summary.internalRevenue).toBe(200.00);
    expect(result.report).toContain('2 invoice(s) pending payment');
    expect(result.report).toContain('800.00');
  });

  it('transfers are cash-neutral (do not affect net balance)', async () => {
    mockGetCostSummary.mockResolvedValueOnce({ status: 'error', message: 'n/a' });
    mockFetchAll.mockResolvedValueOnce({
      resources: [
        { entryType: 'revenue', amount: 100.00, currency: 'USD', status: 'confirmed' },
        { entryType: 'transfer', amount: 99999.00, currency: 'USD', status: 'confirmed' },
      ],
    });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as {
      summary: { internalRevenue: number; netBalance: number };
    };

    expect(result.summary.internalRevenue).toBe(100.00); // transfer doesn't add to revenue
    expect(result.summary.netBalance).toBe(100.00);      // transfer doesn't affect net balance
  });

  it('shows negative net balance when expenses exceed revenue', async () => {
    mockGetCostSummary.mockResolvedValueOnce({ status: 'error', message: 'n/a' });
    mockFetchAll.mockResolvedValueOnce({
      resources: [
        { entryType: 'expense', amount: 500.00, currency: 'USD', status: 'confirmed' },
        { entryType: 'revenue', amount: 200.00, currency: 'USD', status: 'confirmed' },
      ],
    });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as {
      summary: { netBalance: number };
      report: string;
    };

    expect(result.summary.netBalance).toBe(-300.00);
    expect(result.report).toContain('-$300.00');
  });

  it('flags negative net balance as a risk', async () => {
    mockGetCostSummary.mockResolvedValueOnce({ status: 'error', message: 'n/a' });
    mockFetchAll.mockResolvedValueOnce({
      resources: [
        { entryType: 'expense', amount: 200.00, currency: 'USD', status: 'confirmed' },
      ],
    });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as { report: string };

    expect(result.report).toContain('Risk Highlights');
    expect(result.report).toContain('Expenses exceed revenue');
  });

  it('flags elevated Azure spend above $100 MTD as a risk', async () => {
    mockGetCostSummary.mockResolvedValueOnce(SUCCESS_COST_SUMMARY); // $59.11 — below $100 threshold
    mockFetchAll.mockResolvedValueOnce({ resources: [] });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as { report: string };

    // $59.11 is below $100 threshold — risk warning should NOT appear
    expect(result.report).not.toContain('Azure spend is elevated');
  });

  it('flags elevated Azure spend when cost exceeds $100', async () => {
    const highCostSummary = {
      ...SUCCESS_COST_SUMMARY,
      totalCost: 150.00,
    };
    mockGetCostSummary.mockResolvedValueOnce(highCostSummary);
    mockFetchAll.mockResolvedValueOnce({ resources: [] });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as { report: string };

    expect(result.report).toContain('Azure spend is elevated');
  });

  it('includes Azure velocity and projection in burn section when available', async () => {
    mockGetCostSummary.mockResolvedValueOnce(SUCCESS_COST_SUMMARY); // has velocity=5.91, projected=177.33
    mockFetchAll.mockResolvedValueOnce({ resources: [] });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as { report: string };

    expect(result.report).toContain('5.91/day');
    expect(result.report).toContain('177.33');
  });

  it('shows no-risks message when everything is healthy', async () => {
    mockGetCostSummary.mockResolvedValueOnce(SUCCESS_COST_SUMMARY); // $59.11 — below threshold
    mockFetchAll.mockResolvedValueOnce({
      resources: [
        { entryType: 'revenue', amount: 500.00, currency: 'USD', status: 'confirmed' },
        { entryType: 'expense', amount: 100.00, currency: 'USD', status: 'confirmed' },
      ],
    });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as { report: string };

    expect(result.report).toContain('No critical risks identified');
  });

  it('rejects unknown period value', async () => {
    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    await expect(hr_generate_owner_report({ period: 'next-year' })).rejects.toThrow();
  });

  it('includes forward plan section in output', async () => {
    mockGetCostSummary.mockResolvedValueOnce({ status: 'error', message: 'n/a' });
    mockFetchAll.mockResolvedValueOnce({ resources: [] });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as { report: string };

    expect(result.report).toContain('Forward Plan');
  });

  it('returns generatedAt ISO timestamp', async () => {
    mockGetCostSummary.mockResolvedValueOnce({ status: 'error', message: 'n/a' });
    mockFetchAll.mockResolvedValueOnce({ resources: [] });

    const { hr_generate_owner_report } = await import('../../skills/hr/handlers.js');
    const result = await hr_generate_owner_report({}) as { generatedAt: string };

    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
