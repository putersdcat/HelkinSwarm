import { z } from 'zod';
import { getBearerToken } from '../auth/identity.js';
import { getEnvConfig } from '../config/envConfig.js';

export interface CostBreakdownItem {
  service: string;
  cost: number;
}

export interface DailyCostItem {
  date: string;
  cost: number;
}

export type AzureCostSummary =
  | {
      status: 'success';
      period: 'MonthToDate';
      resourceGroup: string;
      currency: string;
      totalCost: number;
      breakdown: CostBreakdownItem[];
      daily: DailyCostItem[];
    }
  | {
      status: 'unavailable' | 'forbidden' | 'error';
      message: string;
      detail?: string;
    };

const CostResultSchema = z.object({
  properties: z.object({
    columns: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
    rows: z.array(z.array(z.unknown())).optional(),
  }).optional(),
});

async function queryCostManagement(body: Record<string, unknown>): Promise<unknown> {
  const config = getEnvConfig();
  const subscriptionId = config.azureSubscriptionId;
  const resourceGroup = config.azureResourceGroup;

  if (!subscriptionId || !resourceGroup) {
    return {
      status: 'unavailable',
      message: 'Azure subscription context not configured (AZURE_SUBSCRIPTION_ID / AZURE_RESOURCE_GROUP missing).',
    } satisfies AzureCostSummary;
  }

  let token: string;
  try {
    token = await getBearerToken('https://management.azure.com/.default');
  } catch (err) {
    return {
      status: 'error',
      message: `Failed to acquire Azure management token: ${err instanceof Error ? err.message : String(err)}`,
    } satisfies AzureCostSummary;
  }

  const url =
    `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}` +
    `/resourceGroups/${encodeURIComponent(resourceGroup)}` +
    `/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      status: 'error',
      message: `Cost Management API request failed: ${err instanceof Error ? err.message : String(err)}`,
    } satisfies AzureCostSummary;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 403) {
      return {
        status: 'forbidden',
        message: 'Cost Management Reader role not yet assigned to the managed identity. Re-deploy infra/main.bicep to apply.',
      } satisfies AzureCostSummary;
    }
    return {
      status: 'error',
      message: `Cost Management API: ${response.status} ${response.statusText}`,
      detail: text.substring(0, 400),
    } satisfies AzureCostSummary;
  }

  return response.json() as Promise<unknown>;
}

export async function getAzureResourceGroupCostSummary(): Promise<AzureCostSummary> {
  const config = getEnvConfig();
  const resourceGroup = config.azureResourceGroup;

  const summaryBody = {
    type: 'ActualCost',
    dataSet: {
      granularity: 'None',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
      grouping: [{ type: 'Dimension', name: 'ServiceName' }],
    },
    timeframe: 'MonthToDate',
  };

  const dailyBody = {
    type: 'ActualCost',
    dataSet: {
      granularity: 'Daily',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
    },
    timeframe: 'MonthToDate',
  };

  const [summaryRaw, dailyRaw] = await Promise.all([
    queryCostManagement(summaryBody),
    queryCostManagement(dailyBody),
  ]);

  if (
    typeof summaryRaw === 'object' &&
    summaryRaw !== null &&
    'status' in summaryRaw &&
    (summaryRaw.status === 'unavailable' || summaryRaw.status === 'forbidden' || summaryRaw.status === 'error')
  ) {
    return summaryRaw as AzureCostSummary;
  }

  const parsedSummary = CostResultSchema.safeParse(summaryRaw);
  if (!parsedSummary.success || !parsedSummary.data.properties) {
    return { status: 'error', message: 'Unexpected Cost Management API response shape.' };
  }

  const summaryColumns = parsedSummary.data.properties.columns ?? [];
  const summaryRows = parsedSummary.data.properties.rows ?? [];
  const costIdx = summaryColumns.findIndex((c) => c.name === 'Cost');
  const currencyIdx = summaryColumns.findIndex((c) => c.name === 'Currency');
  const serviceIdx = summaryColumns.findIndex((c) => c.name === 'ServiceName');

  let totalCost = 0;
  let currency = 'USD';
  const breakdown: CostBreakdownItem[] = [];

  for (const row of summaryRows) {
    const cost = typeof row[costIdx] === 'number' ? row[costIdx] as number : 0;
    const svc = typeof row[serviceIdx] === 'string' ? row[serviceIdx] as string : 'Unknown';
    if (typeof row[currencyIdx] === 'string') currency = row[currencyIdx] as string;
    totalCost += cost;
    if (cost > 0) {
      breakdown.push({ service: svc, cost: Math.round(cost * 100) / 100 });
    }
  }
  breakdown.sort((a, b) => b.cost - a.cost);

  const daily: DailyCostItem[] = [];
  const parsedDaily = CostResultSchema.safeParse(dailyRaw);
  if (parsedDaily.success && parsedDaily.data.properties) {
    const dailyColumns = parsedDaily.data.properties.columns ?? [];
    const dailyRows = parsedDaily.data.properties.rows ?? [];
    const dailyCostIdx = dailyColumns.findIndex((c) => c.name === 'Cost');
    const dateIdx = dailyColumns.findIndex((c) => c.name === 'UsageDate' || c.name === 'Date');
    const dailyCurrencyIdx = dailyColumns.findIndex((c) => c.name === 'Currency');

    for (const row of dailyRows) {
      const cost = typeof row[dailyCostIdx] === 'number' ? row[dailyCostIdx] as number : 0;
      const rawDate = row[dateIdx];
      if (typeof row[dailyCurrencyIdx] === 'string') currency = row[dailyCurrencyIdx] as string;

      let normalizedDate = '';
      if (typeof rawDate === 'string') {
        normalizedDate = rawDate.includes('T') ? rawDate.slice(0, 10) : rawDate;
      } else if (typeof rawDate === 'number') {
        const asString = String(rawDate);
        if (asString.length === 8) {
          normalizedDate = `${asString.slice(0, 4)}-${asString.slice(4, 6)}-${asString.slice(6, 8)}`;
        }
      }

      if (normalizedDate) {
        daily.push({ date: normalizedDate, cost: Math.round(cost * 100) / 100 });
      }
    }

    daily.sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    status: 'success',
    period: 'MonthToDate',
    resourceGroup: resourceGroup ?? 'unknown',
    currency,
    totalCost: Math.round(totalCost * 100) / 100,
    breakdown,
    daily,
  };
}