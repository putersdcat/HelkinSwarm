// Human Relations & Owner Reporting skill handlers.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md §6
// Issue: #245
//
// Aggregates Azure infrastructure burn (via azureCostManagement integration)
// and internal ledger data (direct Cosmos query against the 'ledger' container)
// into a combined executive summary for the virtual company owner.
//
// Storage: COSMOS_ENDPOINT env var → 'helkinswarm' DB → 'ledger' container (read-only)
// Auth: UAMI credential (ManagedIdentityCredential when AZURE_CLIENT_ID set, else DefaultAzureCredential)

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import { CosmosClient } from '@azure/cosmos';
import { z } from 'zod';

const COSMOS_DATABASE = 'helkinswarm';
const LEDGER_CONTAINER = 'ledger';

// ---------------------------------------------------------------------------
// Credential singleton
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
// Cosmos singleton — read-only access to the ledger container
// ---------------------------------------------------------------------------

let _cosmos: CosmosClient | undefined;

function getLedgerContainer() {
  if (!_cosmos) {
    const endpoint = process.env['COSMOS_ENDPOINT'];
    if (!endpoint) throw new Error('COSMOS_ENDPOINT is not set — ledger data unavailable.');
    _cosmos = new CosmosClient({
      endpoint,
      aadCredentials: getCredential(),
      connectionPolicy: { requestTimeout: 10_000 },
    });
  }
  return _cosmos.database(COSMOS_DATABASE).container(LEDGER_CONTAINER);
}

// ---------------------------------------------------------------------------
// Period bounds helper
// ---------------------------------------------------------------------------

interface PeriodBounds {
  fromDate: string;
  toDate: string;
  label: string;
}

function periodBounds(period: string): PeriodBounds {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed

  if (period === 'this-month') {
    return {
      fromDate: `${year}-${String(month + 1).padStart(2, '0')}-01`,
      toDate: now.toISOString().slice(0, 10),
      label: `This month (${now.toLocaleString('default', { month: 'long', year: 'numeric', timeZone: 'UTC' })})`,
    };
  }

  if (period === 'last-month') {
    const lastMonth = month === 0 ? 11 : month - 1;
    const lastYear = month === 0 ? year - 1 : year;
    const lastDay = new Date(Date.UTC(lastYear, lastMonth + 1, 0)).getUTCDate();
    return {
      fromDate: `${lastYear}-${String(lastMonth + 1).padStart(2, '0')}-01`,
      toDate: `${lastYear}-${String(lastMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      label: `Last month (${new Date(Date.UTC(lastYear, lastMonth)).toLocaleString('default', { month: 'long', year: 'numeric', timeZone: 'UTC' })})`,
    };
  }

  // all-time
  return {
    fromDate: '2000-01-01',
    toDate: now.toISOString().slice(0, 10),
    label: 'All time',
  };
}

// ---------------------------------------------------------------------------
// hr_generate_owner_report
// ---------------------------------------------------------------------------

const ReportArgsSchema = z.object({
  period: z.enum(['this-month', 'last-month', 'all-time']).optional().default('this-month'),
});

interface LedgerRow {
  entryType: string;
  amount: number;
  currency: string;
  status: string;
}

export const hr_generate_owner_report: ToolHandler = async (args) => {
  const parsed = ReportArgsSchema.parse(args);
  const { period } = parsed;
  const { fromDate, toDate, label: periodLabel } = periodBounds(period);

  // 1. Ledger aggregation — read directly from Cosmos 'ledger' container
  let totalExpenses = 0;
  let totalRevenue = 0;
  let openInvoiceCount = 0;
  let openInvoiceTotal = 0;
  let ledgerAvailable = true;
  const currency = 'USD';

  try {
    const container = getLedgerContainer();
    const { resources: entries } = await container.items.query<LedgerRow>({
      query: `SELECT c.entryType, c.amount, c.currency, c.status
              FROM c
              WHERE c.date >= @fromDate AND c.date <= @toDate`,
      parameters: [
        { name: '@fromDate', value: fromDate },
        { name: '@toDate', value: toDate },
      ],
    }).fetchAll();

    for (const entry of entries) {
      switch (entry.entryType) {
        case 'expense':
          if (entry.status === 'confirmed' || entry.status === 'draft') {
            totalExpenses += entry.amount;
          }
          break;
        case 'revenue':
          if (entry.status === 'confirmed' || entry.status === 'paid') {
            totalRevenue += entry.amount;
          }
          break;
        case 'invoice':
          if (entry.status === 'pending') {
            openInvoiceCount++;
            openInvoiceTotal += entry.amount;
          } else if (entry.status === 'paid') {
            totalRevenue += entry.amount; // paid invoices are income
          }
          break;
        case 'transfer':
          // transfers are cash-neutral — do not affect net balance
          break;
      }
    }
  } catch {
    ledgerAvailable = false;
  }

  // 2. Azure infrastructure burn — via shared integration (dynamic import keeps skills/ ↔ src/ boundary clean)
  let azureBurnMtd: string | null = null;
  let azureDailyVelocity: string | null = null;
  let azureProjected: string | null = null;
  let azureBurnRaw: number | null = null;

  try {
    const { getAzureResourceGroupCostSummary } = await import(
      '../../src/integrations/azureCostManagement.js'
    );
    const summary = await getAzureResourceGroupCostSummary();

    if (summary.status === 'success') {
      azureBurnRaw = summary.totalCost;
      azureBurnMtd = `$${summary.totalCost.toFixed(2)} ${summary.currency} MTD`;
      if (
        summary.comparison.status === 'available' &&
        summary.comparison.currentVelocity !== null
      ) {
        azureDailyVelocity = `$${summary.comparison.currentVelocity.toFixed(2)}/day`;
      }
      if (
        summary.comparison.status === 'available' &&
        summary.comparison.projectedMonthEndCost !== null
      ) {
        azureProjected = `$${summary.comparison.projectedMonthEndCost.toFixed(2)} projected`;
      }
    }
  } catch {
    // Azure cost API unavailable — proceed without it
  }

  // 3. Compose executive summary report
  const netBalance = totalRevenue - totalExpenses;
  const netFormatted = netBalance >= 0
    ? `+$${netBalance.toFixed(2)}`
    : `-$${Math.abs(netBalance).toFixed(2)}`;

  const sections: string[] = [];
  sections.push(`## 📊 Owner Report — ${periodLabel}`);
  sections.push(`_Generated ${new Date().toISOString().slice(0, 10)}_`);

  // Infrastructure burn
  sections.push('\n**🔥 Infrastructure Burn**');
  if (azureBurnMtd) {
    const burnLine = [azureBurnMtd, azureDailyVelocity, azureProjected]
      .filter(Boolean)
      .join(' · ');
    sections.push(burnLine);
  } else {
    sections.push('Infrastructure cost data unavailable.');
  }

  // Internal ledger
  sections.push('\n**💼 Internal Ledger**');
  if (ledgerAvailable) {
    sections.push(`Revenue: ${currency} ${totalRevenue.toFixed(2)}`);
    sections.push(`Expenses: ${currency} ${totalExpenses.toFixed(2)}`);
    sections.push(`Net balance: ${netFormatted}`);
    if (openInvoiceCount > 0) {
      sections.push(`Open invoices: ${openInvoiceCount} (${currency} ${openInvoiceTotal.toFixed(2)} outstanding)`);
    } else {
      sections.push('Open invoices: none');
    }
  } else {
    sections.push('Ledger data unavailable.');
  }

  // Risk highlights
  sections.push('\n**⚠️ Risk Highlights**');
  const risks: string[] = [];
  if (netBalance < 0 && ledgerAvailable) {
    risks.push(`Net balance is negative (${currency} ${netBalance.toFixed(2)}). Expenses exceed revenue this period.`);
  }
  if (openInvoiceCount > 0) {
    risks.push(`${openInvoiceCount} invoice(s) pending payment — ${currency} ${openInvoiceTotal.toFixed(2)} outstanding.`);
  }
  if (azureBurnRaw !== null && azureBurnRaw > 100) {
    risks.push(`Azure spend is elevated ($${azureBurnRaw.toFixed(2)} MTD). Check Log Analytics and Container Apps for optimisation opportunities.`);
  }
  if (risks.length === 0) {
    sections.push('No critical risks identified for this period.');
  } else {
    for (const r of risks) {
      sections.push(`⚠️ ${r}`);
    }
  }

  // Forward plan placeholder
  sections.push('\n**🗓️ Forward Plan**');
  sections.push('_(30/60/90-day planning requires additional activity data — future slice)_');

  return {
    status: 'success',
    period,
    periodLabel,
    generatedAt: new Date().toISOString(),
    summary: {
      azureBurnMtd: azureBurnRaw,
      internalRevenue: totalRevenue,
      internalExpenses: totalExpenses,
      netBalance,
      openInvoiceCount,
      openInvoiceTotal,
    },
    report: sections.join('\n'),
  };
};
