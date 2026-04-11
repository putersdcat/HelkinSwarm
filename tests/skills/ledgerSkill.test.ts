// Tests for Lightweight Ledger skill handlers
// Issue: #246

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Cosmos SDK before importing handlers
// ---------------------------------------------------------------------------

const mockItems = {
  create: vi.fn().mockResolvedValue({}),
  upsert: vi.fn().mockResolvedValue({}),
  query: vi.fn(),
};

const mockItem = vi.fn();

const mockContainer = {
  items: mockItems,
  item: mockItem,
};

vi.mock('@azure/cosmos', () => ({
  CosmosClient: class {
    database() {
      return { container: () => mockContainer };
    }
  },
}));

vi.mock('@azure/identity', () => ({
  ManagedIdentityCredential: class {},
  DefaultAzureCredential: class {},
}));

// Set required env vars before lazy singletons initialize
process.env['COSMOS_ENDPOINT'] = 'https://mock-cosmos.documents.azure.com';

import {
  ledger_record_entry,
  ledger_list_entries,
  ledger_get_summary,
  ledger_update_entry_status,
} from '../../skills/ledger/handlers.js';

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// ledger_record_entry
// ---------------------------------------------------------------------------

describe('ledger_record_entry', () => {
  it('records an expense entry and returns confirmation with UUID', async () => {
    const result = await ledger_record_entry({
      entryType: 'expense',
      amount: 49.99,
      description: 'Azure hosting October',
      category: 'hosting',
    });
    expect(result).toContain('Expense recorded');
    expect(result).toContain('49.99');
    expect(result).toContain('hosting');
    expect(result).toContain('confirmed'); // default status for expense
    expect(mockItems.create).toHaveBeenCalledOnce();
  });

  it('records an invoice with pending status by default', async () => {
    const result = await ledger_record_entry({
      entryType: 'invoice',
      amount: 1500.00,
      description: 'Consulting services Nov 2026',
      category: 'consulting',
    });
    expect(result).toContain('Invoice recorded');
    expect(result).toContain('pending'); // default status for invoice
    const created = mockItems.create.mock.calls[0]?.[0] as { status: string };
    expect(created?.status).toBe('pending');
  });

  it('records a revenue entry with explicit date', async () => {
    const result = await ledger_record_entry({
      entryType: 'revenue',
      amount: 500.00,
      description: 'Side project payment',
      date: '2026-04-05',
    });
    expect(result).toContain('Revenue recorded');
    expect(result).toContain('2026-04-05');
    expect(result).toContain('500.00');
  });

  it('passes notes and referenceId to the stored entry', async () => {
    await ledger_record_entry({
      entryType: 'expense',
      amount: 20.00,
      description: 'Domain renewal',
      notes: 'Annual fee',
      referenceId: 'inv-001',
    });
    const stored = mockItems.create.mock.calls[0]?.[0] as {
      notes: string;
      referenceId: string;
    };
    expect(stored?.notes).toBe('Annual fee');
    expect(stored?.referenceId).toBe('inv-001');
  });

  it('rejects negative amounts', async () => {
    await expect(ledger_record_entry({ entryType: 'expense', amount: -50, description: 'bad' }))
      .rejects.toThrow();
  });

  it('rejects invalid entryType', async () => {
    await expect(ledger_record_entry({ entryType: 'debt', amount: 100, description: 'test' }))
      .rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ledger_list_entries
// ---------------------------------------------------------------------------

describe('ledger_list_entries', () => {
  beforeEach(() => {
    mockItems.query.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({
        resources: [
          {
            id: 'aaaaaaaa-0000-0000-0000-000000000001',
            entryType: 'expense',
            amount: 49.99,
            currency: 'USD',
            date: '2026-04-01',
            description: 'Azure hosting',
            category: 'hosting',
            status: 'confirmed',
            recordedAt: '2026-04-01T10:00:00Z',
            recordedBy: 'owner',
          },
          {
            id: 'bbbbbbbb-0000-0000-0000-000000000002',
            entryType: 'invoice',
            amount: 1500.00,
            currency: 'USD',
            date: '2026-04-02',
            description: 'Consulting services',
            category: 'consulting',
            status: 'pending',
            recordedAt: '2026-04-02T11:00:00Z',
            recordedBy: 'owner',
          },
        ],
      }),
    });
  });

  it('returns formatted list of entries', async () => {
    const result = await ledger_list_entries({});
    expect(result).toContain('2 ledger entries');
    expect(result).toContain('Azure hosting');
    expect(result).toContain('Consulting services');
    expect(result).toContain('49.99');
    expect(result).toContain('1500.00');
  });

  it('returns a no-results message when empty', async () => {
    mockItems.query.mockReturnValue({ fetchAll: vi.fn().mockResolvedValue({ resources: [] }) });
    const result = await ledger_list_entries({});
    expect(result).toContain('No ledger entries found');
  });

  it('passes entryType filter in query', async () => {
    await ledger_list_entries({ entryType: 'expense' });
    expect(mockItems.query).toHaveBeenCalledOnce();
    const queryArg = mockItems.query.mock.calls[0]?.[0] as { query: string; parameters: { name: string; value: string }[] };
    expect(queryArg.query).toContain('c.entryType = @entryType');
    expect(queryArg.parameters.some((p) => p.name === '@entryType' && p.value === 'expense')).toBe(true);
  });

  it('applies fromDate and toDate filters', async () => {
    await ledger_list_entries({ fromDate: '2026-04-01', toDate: '2026-04-30' });
    const queryArg = mockItems.query.mock.calls[0]?.[0] as { query: string; parameters: { name: string; value: string }[] };
    expect(queryArg.query).toContain('c.date >= @fromDate');
    expect(queryArg.query).toContain('c.date <= @toDate');
  });
});

// ---------------------------------------------------------------------------
// ledger_get_summary
// ---------------------------------------------------------------------------

describe('ledger_get_summary', () => {
  it('aggregates expenses and revenues into net balance', async () => {
    mockItems.query.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({
        resources: [
          { entryType: 'expense', amount: 100.00, currency: 'USD', status: 'confirmed' },
          { entryType: 'expense', amount: 50.00,  currency: 'USD', status: 'confirmed' },
          { entryType: 'revenue', amount: 300.00, currency: 'USD', status: 'confirmed' },
        ],
      }),
    });
    const result = await ledger_get_summary({});
    expect(result).toContain('150.00');   // total expenses
    expect(result).toContain('300.00');   // total revenue
    expect(result).toContain('+$150.00'); // net balance
  });

  it('shows negative net balance when expenses exceed revenue', async () => {
    mockItems.query.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({
        resources: [
          { entryType: 'expense', amount: 500.00, currency: 'USD', status: 'confirmed' },
          { entryType: 'revenue', amount: 200.00, currency: 'USD', status: 'confirmed' },
        ],
      }),
    });
    const result = await ledger_get_summary({});
    expect(result).toContain('-$300.00');
  });

  it('includes paid invoices in revenue total', async () => {
    mockItems.query.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({
        resources: [
          { entryType: 'invoice', amount: 1000.00, currency: 'USD', status: 'paid' },
          { entryType: 'expense',  amount:  200.00, currency: 'USD', status: 'confirmed' },
        ],
      }),
    });
    const result = await ledger_get_summary({});
    expect(result).toContain('1000.00'); // paid invoice counted as revenue
    expect(result).toContain('+$800.00');
  });

  it('shows pending invoices as outstanding', async () => {
    mockItems.query.mockReturnValue({
      fetchAll: vi.fn().mockResolvedValue({
        resources: [
          { entryType: 'invoice', amount: 2000.00, currency: 'USD', status: 'pending' },
        ],
      }),
    });
    const result = await ledger_get_summary({});
    expect(result).toContain('2000.00'); // outstanding invoice shown
    expect(result).toContain('Outstanding Invoices');
  });

  it('uses period label for all-time', async () => {
    mockItems.query.mockReturnValue({ fetchAll: vi.fn().mockResolvedValue({ resources: [] }) });
    const result = await ledger_get_summary({ period: 'all-time' });
    expect(result).toContain('All time');
  });

  it('uses period label for this-month', async () => {
    mockItems.query.mockReturnValue({ fetchAll: vi.fn().mockResolvedValue({ resources: [] }) });
    const result = await ledger_get_summary({ period: 'this-month' });
    expect(result).toContain('This month');
  });
});

// ---------------------------------------------------------------------------
// ledger_update_entry_status
// ---------------------------------------------------------------------------

describe('ledger_update_entry_status', () => {
  const existingEntry = {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    entryType: 'invoice',
    amount: 1500.00,
    currency: 'USD',
    date: '2026-04-02',
    description: 'Consulting invoice',
    category: 'consulting',
    status: 'pending',
    recordedAt: '2026-04-02T11:00:00Z',
    recordedBy: 'owner',
  };

  it('updates entry status to paid', async () => {
    mockItem.mockReturnValue({
      read: vi.fn().mockResolvedValue({ resource: existingEntry }),
    });
    const result = await ledger_update_entry_status({
      entryId: existingEntry.id,
      entryType: 'invoice',
      status: 'paid',
    });
    expect(result).toContain('status updated');
    expect(result).toContain('paid');
    expect(result).toContain('Consulting invoice');
    expect(mockItems.upsert).toHaveBeenCalledOnce();
    const upserted = mockItems.upsert.mock.calls[0]?.[0] as { status: string };
    expect(upserted?.status).toBe('paid');
  });

  it('returns not-found message for missing entry', async () => {
    mockItem.mockReturnValue({
      read: vi.fn().mockResolvedValue({ resource: undefined }),
    });
    const result = await ledger_update_entry_status({
      entryId: 'aaaaaaaa-0000-0000-0000-000000000099',
      entryType: 'invoice',
      status: 'cancelled',
    });
    expect(result).toContain('Entry not found');
  });

  it('rejects invalid status value', async () => {
    await expect(ledger_update_entry_status({
      entryId: 'aaaaaaaa-0000-0000-0000-000000000001',
      entryType: 'invoice',
      status: 'overdue', // not a valid status
    })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// periodBounds helper (indirect via ledger_get_summary)
// ---------------------------------------------------------------------------

describe('period filtering', () => {
  it('passes fromDate constraint for this-month', async () => {
    mockItems.query.mockReturnValue({ fetchAll: vi.fn().mockResolvedValue({ resources: [] }) });
    await ledger_get_summary({ period: 'this-month' });
    const queryArg = mockItems.query.mock.calls[0]?.[0] as { query: string; parameters: { name: string; value: string }[] };
    expect(queryArg.parameters.some((p) => p.name === '@fromDate')).toBe(true);
    // No toDate for this-month (unbounded upper end)
    expect(queryArg.parameters.some((p) => p.name === '@toDate')).toBe(false);
  });

  it('passes both fromDate and toDate for last-month', async () => {
    mockItems.query.mockReturnValue({ fetchAll: vi.fn().mockResolvedValue({ resources: [] }) });
    await ledger_get_summary({ period: 'last-month' });
    const queryArg = mockItems.query.mock.calls[0]?.[0] as { query: string; parameters: { name: string; value: string }[] };
    expect(queryArg.parameters.some((p) => p.name === '@fromDate')).toBe(true);
    expect(queryArg.parameters.some((p) => p.name === '@toDate')).toBe(true);
  });
});
