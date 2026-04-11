// Lightweight Ledger skill handlers — Cosmos-backed financial bookkeeping.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md §6
// Issue: #246
//
// Storage: COSMOS_ENDPOINT env var → 'helkinswarm' DB → 'ledger' container
// Partition key: /entryType ('expense'|'revenue'|'invoice'|'transfer')
// Auth: UAMI credential (ManagedIdentityCredential when AZURE_CLIENT_ID is set,
//       DefaultAzureCredential in local dev).

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import { CosmosClient, type SqlParameter } from '@azure/cosmos';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const COSMOS_DATABASE = 'helkinswarm';
const COSMOS_CONTAINER = 'ledger';

// ---------------------------------------------------------------------------
// Credential singleton — mirrors docs/handlers.ts pattern
// ---------------------------------------------------------------------------

let _cred: TokenCredential | undefined;

function getCredential(): TokenCredential {
  if (!_cred) {
    const clientId = process.env['AZURE_CLIENT_ID'];
    _cred = clientId
      ? new ManagedIdentityCredential({ clientId })
      : new DefaultAzureCredential();
  }
  return _cred;
}

// ---------------------------------------------------------------------------
// Cosmos singleton — per-skill, no cross-boundary src/ import
// ---------------------------------------------------------------------------

let _cosmos: CosmosClient | undefined;

function getLedgerContainer() {
  if (!_cosmos) {
    const endpoint = process.env['COSMOS_ENDPOINT'];
    if (!endpoint) {
      throw new Error(
        'Ledger not configured — COSMOS_ENDPOINT is not set.',
      );
    }
    _cosmos = new CosmosClient({
      endpoint,
      aadCredentials: getCredential(),
      connectionPolicy: { requestTimeout: 10_000 },
    });
  }
  return _cosmos.database(COSMOS_DATABASE).container(COSMOS_CONTAINER);
}

// ---------------------------------------------------------------------------
// Types and Zod schemas
// ---------------------------------------------------------------------------

const ENTRY_TYPES = ['expense', 'revenue', 'invoice', 'transfer'] as const;
const STATUSES = ['draft', 'pending', 'confirmed', 'paid', 'cancelled'] as const;

type EntryType = (typeof ENTRY_TYPES)[number];
type EntryStatus = (typeof STATUSES)[number];

/** Cosmos document shape — used as generic annotation for SDK calls */
interface LedgerEntry {
  id: string;
  entryType: EntryType;
  amount: number;
  currency: string;
  date: string;
  description: string;
  category: string;
  status: EntryStatus;
  notes?: string;
  referenceId?: string;
  recordedAt: string;
  recordedBy: string;
}

const LedgerEntrySchema = z.object({
  id: z.string().uuid(),
  entryType: z.enum(ENTRY_TYPES),
  amount: z.number().positive(),
  currency: z.string().length(3).toUpperCase(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  description: z.string().min(1).max(500),
  category: z.string().min(1).max(100),
  status: z.enum(STATUSES),
  notes: z.string().max(1000).optional(),
  referenceId: z.string().optional(),
  recordedAt: z.string(),
  recordedBy: z.string(),
});

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const RecordEntryArgsSchema = z.object({
  entryType: z.enum(ENTRY_TYPES),
  amount: z.number().positive(),
  currency: z.string().length(3).toUpperCase().default('USD'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().min(1).max(500),
  category: z.string().min(1).max(100).default('general'),
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(1000).optional(),
  referenceId: z.string().optional(),
  userId: z.string().optional(), // injected by toolDispatchActivity
});

const ListEntriesArgsSchema = z.object({
  entryType: z.enum(ENTRY_TYPES).optional(),
  category: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const GetSummaryArgsSchema = z.object({
  period: z.enum(['this-month', 'last-month', 'all-time']).default('all-time'),
});

const UpdateStatusArgsSchema = z.object({
  entryId: z.string().uuid(),
  entryType: z.enum(ENTRY_TYPES),
  status: z.enum(STATUSES),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compute [fromDate, toDate] pair for a period relative to today. */
function periodBounds(period: 'this-month' | 'last-month' | 'all-time'): { from: string | null; to: string | null } {
  const now = new Date();
  if (period === 'all-time') return { from: null, to: null };

  if (period === 'this-month') {
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return { from, to: null };
  }

  // last-month
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const from = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-01`;
  const to = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(lastMonthEnd.getDate()).padStart(2, '0')}`;
  return { from, to };
}

function formatAmount(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Tool: ledger_record_entry
// ---------------------------------------------------------------------------

export const ledger_record_entry: ToolHandler = async (args) => {
  const parsed = RecordEntryArgsSchema.parse(args);

  const defaultStatus: EntryStatus = parsed.entryType === 'invoice' ? 'pending' : 'confirmed';
  const entry: LedgerEntry = {
    id: randomUUID(),
    entryType: parsed.entryType,
    amount: parsed.amount,
    currency: parsed.currency,
    date: parsed.date ?? todayIso(),
    description: parsed.description,
    category: parsed.category,
    status: parsed.status ?? defaultStatus,
    notes: parsed.notes,
    referenceId: parsed.referenceId,
    recordedAt: new Date().toISOString(),
    recordedBy: parsed.userId ?? 'owner',
  };

  const container = getLedgerContainer();
  await container.items.create(entry);

  const icon = parsed.entryType === 'expense' ? '💸' :
    parsed.entryType === 'revenue' ? '💰' :
    parsed.entryType === 'invoice' ? '🧾' : '↔️';

  return [
    `${icon} **${parsed.entryType.charAt(0).toUpperCase() + parsed.entryType.slice(1)} recorded**`,
    `**ID:** \`${entry.id}\``,
    `**Amount:** ${formatAmount(entry.amount, entry.currency)}`,
    `**Date:** ${entry.date}`,
    `**Category:** ${entry.category}`,
    `**Status:** ${entry.status}`,
    `**Description:** ${entry.description}`,
    parsed.notes ? `**Notes:** ${parsed.notes}` : null,
  ].filter(Boolean).join('\n');
};

// ---------------------------------------------------------------------------
// Tool: ledger_list_entries
// ---------------------------------------------------------------------------

export const ledger_list_entries: ToolHandler = async (args) => {
  const parsed = ListEntriesArgsSchema.parse(args);

  const container = getLedgerContainer();

  // Build query — cross-partition if no entryType filter, single-partition otherwise
  const conditions: string[] = [];
  const parameters: SqlParameter[] = [];

  if (parsed.entryType) {
    conditions.push('c.entryType = @entryType');
    parameters.push({ name: '@entryType', value: parsed.entryType });
  }
  if (parsed.category) {
    conditions.push('c.category = @category');
    parameters.push({ name: '@category', value: parsed.category });
  }
  if (parsed.status) {
    conditions.push('c.status = @status');
    parameters.push({ name: '@status', value: parsed.status });
  }
  if (parsed.fromDate) {
    conditions.push('c.date >= @fromDate');
    parameters.push({ name: '@fromDate', value: parsed.fromDate });
  }
  if (parsed.toDate) {
    conditions.push('c.date <= @toDate');
    parameters.push({ name: '@toDate', value: parsed.toDate });
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM c ${where} ORDER BY c.date DESC OFFSET 0 LIMIT ${parsed.limit}`;

  const { resources } = await container.items.query<LedgerEntry>(
    { query, parameters },
  ).fetchAll();

  if (resources.length === 0) {
    return 'No ledger entries found matching the given filters.';
  }

  const lines = resources.map((e) => {
    const icon = e.entryType === 'expense' ? '💸' :
      e.entryType === 'revenue' ? '💰' :
      e.entryType === 'invoice' ? '🧾' : '↔️';
    const statusBadge = e.status === 'paid' ? '✅' :
      e.status === 'cancelled' ? '❌' :
      e.status === 'pending' ? '⏳' : '';
    return `${icon} **${e.date}** ${formatAmount(e.amount, e.currency)} — ${e.description} [${e.category}] ${statusBadge} _${e.id.slice(0, 8)}..._`;
  });

  const header = `**${resources.length} ledger entries**${parsed.entryType ? ` (${parsed.entryType})` : ''}:`;
  return `${header}\n\n${lines.join('\n')}`;
};

// ---------------------------------------------------------------------------
// Tool: ledger_get_summary
// ---------------------------------------------------------------------------

export const ledger_get_summary: ToolHandler = async (args) => {
  const parsed = GetSummaryArgsSchema.parse(args);

  const { from, to } = periodBounds(parsed.period);
  const container = getLedgerContainer();

  // Fetch all non-cancelled entries in period — cross-partition query
  const conditions: string[] = ['c.status != \'cancelled\''];
  const parameters: SqlParameter[] = [];

  if (from) {
    conditions.push('c.date >= @fromDate');
    parameters.push({ name: '@fromDate', value: from });
  }
  if (to) {
    conditions.push('c.date <= @toDate');
    parameters.push({ name: '@toDate', value: to });
  }

  const query = `SELECT c.entryType, c.amount, c.currency, c.status FROM c WHERE ${conditions.join(' AND ')}`;
  const { resources } = await container.items.query<Pick<LedgerEntry, 'entryType' | 'amount' | 'currency' | 'status'>>(
    { query, parameters },
  ).fetchAll();

  // Aggregate — assume USD for MVP (multi-currency support is future work)
  let totalExpenses = 0;
  let totalRevenue = 0;
  let totalPendingInvoices = 0;
  let expenseCount = 0;
  let revenueCount = 0;
  let invoiceCount = 0;
  let invoicePaidCount = 0;

  for (const entry of resources) {
    if (entry.entryType === 'expense') {
      totalExpenses += entry.amount;
      expenseCount++;
    } else if (entry.entryType === 'revenue') {
      totalRevenue += entry.amount;
      revenueCount++;
    } else if (entry.entryType === 'invoice') {
      invoiceCount++;
      if (entry.status === 'pending') {
        totalPendingInvoices += entry.amount;
      } else if (entry.status === 'paid') {
        totalRevenue += entry.amount;
        invoicePaidCount++;
        revenueCount++;
      }
    }
  }

  const netBalance = totalRevenue - totalExpenses;
  const netFormatted = netBalance >= 0
    ? `+$${netBalance.toFixed(2)}`
    : `-$${Math.abs(netBalance).toFixed(2)}`;
  const periodLabel = parsed.period === 'this-month' ? 'This month' :
    parsed.period === 'last-month' ? 'Last month' : 'All time';

  return [
    `## 📊 Ledger Summary — ${periodLabel}`,
    '',
    `**💸 Total Expenses:** $${totalExpenses.toFixed(2)} (${expenseCount} entries)`,
    `**💰 Total Revenue:** $${totalRevenue.toFixed(2)} (${revenueCount} entries)`,
    `**⚖️ Net Balance:** ${netFormatted}`,
    invoiceCount > 0 ? `**🧾 Outstanding Invoices:** $${totalPendingInvoices.toFixed(2)} (${invoiceCount - invoicePaidCount} pending)` : null,
    '',
    `_Note: Multi-currency entries treated as USD for summary. Cancelled entries excluded._`,
  ].filter((l) => l !== null).join('\n');
};

// ---------------------------------------------------------------------------
// Tool: ledger_update_entry_status
// ---------------------------------------------------------------------------

export const ledger_update_entry_status: ToolHandler = async (args) => {
  const { entryId, entryType, status } = UpdateStatusArgsSchema.parse(args);

  const container = getLedgerContainer();
  const { resource: existing } = await container.item(entryId, entryType).read<LedgerEntry>();

  if (!existing) {
    return `Entry not found: \`${entryId}\` (type: ${entryType}). Check the ID and entryType are correct.`;
  }

  const validated = LedgerEntrySchema.parse(existing);
  const updated: LedgerEntry = { ...validated, status };
  await container.items.upsert(updated);

  const icon = updated.entryType === 'invoice' ? '🧾' :
    updated.entryType === 'expense' ? '💸' :
    updated.entryType === 'revenue' ? '💰' : '↔️';

  return [
    `${icon} **Entry status updated**`,
    `**ID:** \`${entryId}\``,
    `**Description:** ${updated.description}`,
    `**Amount:** ${formatAmount(updated.amount, updated.currency)}`,
    `**New status:** ${status}`,
  ].join('\n');
};
