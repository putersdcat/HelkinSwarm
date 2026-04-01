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

export interface CostPeriodSummaryBase {
  label: string;
  periodStart: string;
  periodEnd: string;
  daysInMonth: number;
  currency: string;
}

export type CostPeriodSummary =
  | (CostPeriodSummaryBase & {
      status: 'success';
      totalCost: number;
      breakdown: CostBreakdownItem[];
      daily: DailyCostItem[];
      validDayCount: number;
      lastReportedDate?: string;
    })
  | (CostPeriodSummaryBase & {
      status: 'unavailable';
      totalCost: number;
      breakdown: CostBreakdownItem[];
      daily: DailyCostItem[];
      validDayCount: number;
      message: string;
    });

export interface CostComparisonSummary {
  status: 'available' | 'unavailable';
  compareThroughDay: number | null;
  alignedPreviousDay: number | null;
  currentWindowCost: number | null;
  previousWindowCost: number | null;
  spendDelta: number | null;
  spendDeltaPercent: number | null;
  currentVelocity: number | null;
  previousVelocity: number | null;
  projectedMonthEndCost: number | null;
  previousProjectedMonthEndCost: number | null;
  assumptions: string[];
  message?: string;
  fallbackSuggestion?: string;
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
      currentMonth: CostPeriodSummary;
      previousMonth: CostPeriodSummary;
      comparison: CostComparisonSummary;
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

type CostTimeframe =
  | { kind: 'preset'; value: 'MonthToDate' }
  | { kind: 'custom'; from: Date; to: Date };

type CostQueryError = Extract<AzureCostSummary, { status: 'unavailable' | 'forbidden' | 'error' }>;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function addUtcMonths(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

function daysInUtcMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function parseIsoDateOnly(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function sumCosts(items: DailyCostItem[]): number {
  return roundCurrency(items.reduce((total, item) => total + item.cost, 0));
}

function buildTimeframeClause(timeframe: CostTimeframe): Record<string, unknown> {
  if (timeframe.kind === 'preset') {
    return { timeframe: timeframe.value };
  }

  return {
    timeframe: 'Custom',
    timePeriod: {
      from: timeframe.from.toISOString(),
      to: timeframe.to.toISOString(),
    },
  };
}

function buildCostQueryBody(
  granularity: 'None' | 'Daily',
  timeframe: CostTimeframe,
  includeServiceGrouping: boolean,
): Record<string, unknown> {
  return {
    type: 'ActualCost',
    dataSet: {
      granularity,
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
      ...(includeServiceGrouping
        ? { grouping: [{ type: 'Dimension', name: 'ServiceName' }] }
        : {}),
    },
    ...buildTimeframeClause(timeframe),
  };
}

function isCostQueryError(value: unknown): value is CostQueryError {
  return typeof value === 'object' && value !== null && 'status' in value && (
    value.status === 'unavailable' || value.status === 'forbidden' || value.status === 'error'
  );
}

function normalizeCostDate(rawDate: unknown): string {
  if (typeof rawDate === 'string') {
    return rawDate.includes('T') ? rawDate.slice(0, 10) : rawDate;
  }

  if (typeof rawDate === 'number') {
    const asString = String(rawDate);
    if (asString.length === 8) {
      return `${asString.slice(0, 4)}-${asString.slice(4, 6)}-${asString.slice(6, 8)}`;
    }
  }

  return '';
}

function parseBreakdownSummary(raw: unknown): {
  currency: string;
  totalCost: number;
  breakdown: CostBreakdownItem[];
} | null {
  const parsedSummary = CostResultSchema.safeParse(raw);
  if (!parsedSummary.success || !parsedSummary.data.properties) {
    return null;
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
    const service = typeof row[serviceIdx] === 'string' ? row[serviceIdx] as string : 'Unknown';
    if (typeof row[currencyIdx] === 'string') {
      currency = row[currencyIdx] as string;
    }
    totalCost += cost;
    if (cost > 0) {
      breakdown.push({ service, cost: roundCurrency(cost) });
    }
  }

  breakdown.sort((a, b) => b.cost - a.cost);

  return {
    currency,
    totalCost: roundCurrency(totalCost),
    breakdown,
  };
}

function parseDailySummary(raw: unknown, fallbackCurrency: string): {
  currency: string;
  daily: DailyCostItem[];
} {
  const parsedDaily = CostResultSchema.safeParse(raw);
  if (!parsedDaily.success || !parsedDaily.data.properties) {
    return { currency: fallbackCurrency, daily: [] };
  }

  const dailyColumns = parsedDaily.data.properties.columns ?? [];
  const dailyRows = parsedDaily.data.properties.rows ?? [];
  const dailyCostIdx = dailyColumns.findIndex((c) => c.name === 'Cost');
  const dateIdx = dailyColumns.findIndex((c) => c.name === 'UsageDate' || c.name === 'Date');
  const dailyCurrencyIdx = dailyColumns.findIndex((c) => c.name === 'Currency');

  let currency = fallbackCurrency;
  const daily: DailyCostItem[] = [];

  for (const row of dailyRows) {
    const cost = typeof row[dailyCostIdx] === 'number' ? row[dailyCostIdx] as number : 0;
    const normalizedDate = normalizeCostDate(row[dateIdx]);
    if (typeof row[dailyCurrencyIdx] === 'string') {
      currency = row[dailyCurrencyIdx] as string;
    }

    if (normalizedDate) {
      daily.push({ date: normalizedDate, cost: roundCurrency(cost) });
    }
  }

  daily.sort((a, b) => a.date.localeCompare(b.date));
  return { currency, daily };
}

function buildUnavailablePeriodSummary(
  label: string,
  periodStart: Date,
  periodEnd: Date,
  currency: string,
  message: string,
): CostPeriodSummary {
  return {
    status: 'unavailable',
    label,
    periodStart: isoDateOnly(periodStart),
    periodEnd: isoDateOnly(periodEnd),
    daysInMonth: daysInUtcMonth(periodStart),
    currency,
    totalCost: 0,
    breakdown: [],
    daily: [],
    validDayCount: 0,
    message,
  };
}

function buildPeriodSummary(options: {
  label: string;
  periodStart: Date;
  periodEnd: Date;
  summaryRaw: unknown;
  dailyRaw: unknown;
  fallbackCurrency: string;
}): CostPeriodSummary {
  const summary = parseBreakdownSummary(options.summaryRaw);
  if (!summary) {
    return buildUnavailablePeriodSummary(
      options.label,
      options.periodStart,
      options.periodEnd,
      options.fallbackCurrency,
      'Unexpected Cost Management API response shape for this period.',
    );
  }

  const daily = isCostQueryError(options.dailyRaw)
    ? { currency: summary.currency, daily: [] }
    : parseDailySummary(options.dailyRaw, summary.currency);

  return {
    status: 'success',
    label: options.label,
    periodStart: isoDateOnly(options.periodStart),
    periodEnd: isoDateOnly(options.periodEnd),
    daysInMonth: daysInUtcMonth(options.periodStart),
    currency: daily.currency || summary.currency,
    totalCost: summary.totalCost,
    breakdown: summary.breakdown,
    daily: daily.daily,
    validDayCount: daily.daily.length,
    lastReportedDate: daily.daily[daily.daily.length - 1]?.date,
  };
}

export function buildCostComparisonSummary(
  currentMonth: CostPeriodSummary,
  previousMonth: CostPeriodSummary,
): CostComparisonSummary {
  const assumptions = [
    'Previous-month comparison is aligned to the same calendar day window using min(current day, previous month length).',
    'Velocity is normalized by the number of days that actually reported cost data when early days are missing.',
  ];

  if (currentMonth.status !== 'success' || currentMonth.daily.length === 0) {
    return {
      status: 'unavailable',
      compareThroughDay: null,
      alignedPreviousDay: null,
      currentWindowCost: null,
      previousWindowCost: null,
      spendDelta: null,
      spendDeltaPercent: null,
      currentVelocity: null,
      previousVelocity: null,
      projectedMonthEndCost: null,
      previousProjectedMonthEndCost: null,
      assumptions,
      message: 'Current month trend data is not available yet, so comparison metrics cannot be calculated.',
    };
  }

  const currentLastDate = parseIsoDateOnly(currentMonth.lastReportedDate);
  if (!currentLastDate) {
    return {
      status: 'unavailable',
      compareThroughDay: null,
      alignedPreviousDay: null,
      currentWindowCost: null,
      previousWindowCost: null,
      spendDelta: null,
      spendDeltaPercent: null,
      currentVelocity: null,
      previousVelocity: null,
      projectedMonthEndCost: null,
      previousProjectedMonthEndCost: null,
      assumptions,
      message: 'Current month daily costs did not contain a valid reporting date.',
    };
  }

  const compareThroughDay = currentLastDate.getUTCDate();
  const alignedPreviousDay = Math.min(compareThroughDay, previousMonth.daysInMonth);

  if (previousMonth.status !== 'success' || previousMonth.daily.length === 0) {
    return {
      status: 'unavailable',
      compareThroughDay,
      alignedPreviousDay,
      currentWindowCost: null,
      previousWindowCost: null,
      spendDelta: null,
      spendDeltaPercent: null,
      currentVelocity: null,
      previousVelocity: null,
      projectedMonthEndCost: null,
      previousProjectedMonthEndCost: null,
      assumptions,
      message: previousMonth.status === 'unavailable'
        ? previousMonth.message
        : 'Previous month cost data is not available yet.',
      fallbackSuggestion: 'Use year-to-date or trailing 30d as fallback context until the previous month dataset is available.',
    };
  }

  const currentWindow = currentMonth.daily.filter((item) => {
    const date = parseIsoDateOnly(item.date);
    return date !== null && date.getUTCDate() <= compareThroughDay;
  });
  const previousWindow = previousMonth.daily.filter((item) => {
    const date = parseIsoDateOnly(item.date);
    return date !== null && date.getUTCDate() <= alignedPreviousDay;
  });

  if (previousWindow.length === 0) {
    return {
      status: 'unavailable',
      compareThroughDay,
      alignedPreviousDay,
      currentWindowCost: null,
      previousWindowCost: null,
      spendDelta: null,
      spendDeltaPercent: null,
      currentVelocity: null,
      previousVelocity: null,
      projectedMonthEndCost: null,
      previousProjectedMonthEndCost: null,
      assumptions,
      message: 'Previous month comparison window has no reported cost data yet.',
      fallbackSuggestion: 'Use year-to-date or trailing 30d as fallback context until prior-month data lands.',
    };
  }

  if (alignedPreviousDay !== compareThroughDay) {
    assumptions.push(`Previous month had fewer calendar days, so the comparison is capped at day ${alignedPreviousDay}.`);
  }
  if (currentWindow.length < compareThroughDay) {
    assumptions.push(`Current month is missing ${compareThroughDay - currentWindow.length} early reporting day(s), so velocity is normalized on ${currentWindow.length} valid day(s).`);
  }
  if (previousWindow.length < alignedPreviousDay) {
    assumptions.push(`Previous month is missing ${alignedPreviousDay - previousWindow.length} early reporting day(s), so velocity is normalized on ${previousWindow.length} valid day(s).`);
  }

  const currentWindowCost = sumCosts(currentWindow);
  const previousWindowCost = sumCosts(previousWindow);
  const spendDelta = roundCurrency(currentWindowCost - previousWindowCost);
  const spendDeltaPercent = previousWindowCost > 0
    ? roundTo((spendDelta / previousWindowCost) * 100, 2)
    : null;
  const currentVelocity = currentWindow.length > 0
    ? roundCurrency(currentWindowCost / currentWindow.length)
    : null;
  const previousVelocity = previousWindow.length > 0
    ? roundCurrency(previousWindowCost / previousWindow.length)
    : null;

  return {
    status: 'available',
    compareThroughDay,
    alignedPreviousDay,
    currentWindowCost,
    previousWindowCost,
    spendDelta,
    spendDeltaPercent,
    currentVelocity,
    previousVelocity,
    projectedMonthEndCost: currentVelocity !== null
      ? roundCurrency(currentVelocity * currentMonth.daysInMonth)
      : null,
    previousProjectedMonthEndCost: previousVelocity !== null
      ? roundCurrency(previousVelocity * previousMonth.daysInMonth)
      : null,
    assumptions,
    message: `Comparing through day ${compareThroughDay}.`,
  };
}

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

  const now = new Date();
  const currentMonthStart = startOfUtcMonth(now);
  const currentMonthEnd = endOfUtcMonth(now);
  const previousMonthStart = addUtcMonths(currentMonthStart, -1);
  const previousMonthEnd = endOfUtcMonth(previousMonthStart);

  const [currentSummaryRaw, currentDailyRaw, previousSummaryRaw, previousDailyRaw] = await Promise.all([
    queryCostManagement(buildCostQueryBody('None', { kind: 'preset', value: 'MonthToDate' }, true)),
    queryCostManagement(buildCostQueryBody('Daily', { kind: 'preset', value: 'MonthToDate' }, false)),
    queryCostManagement(buildCostQueryBody('None', { kind: 'custom', from: previousMonthStart, to: previousMonthEnd }, true)),
    queryCostManagement(buildCostQueryBody('Daily', { kind: 'custom', from: previousMonthStart, to: previousMonthEnd }, false)),
  ]);

  if (isCostQueryError(currentSummaryRaw)) {
    return currentSummaryRaw;
  }

  const currentMonth = buildPeriodSummary({
    label: 'Current month',
    periodStart: currentMonthStart,
    periodEnd: currentMonthEnd,
    summaryRaw: currentSummaryRaw,
    dailyRaw: currentDailyRaw,
    fallbackCurrency: 'USD',
  });

  if (currentMonth.status !== 'success') {
    return { status: 'error', message: 'Unexpected Cost Management API response shape.' };
  }

  const previousMonth = isCostQueryError(previousSummaryRaw)
    ? buildUnavailablePeriodSummary(
        'Previous month',
        previousMonthStart,
        previousMonthEnd,
        currentMonth.currency,
        previousSummaryRaw.message,
      )
    : buildPeriodSummary({
        label: 'Previous month',
        periodStart: previousMonthStart,
        periodEnd: previousMonthEnd,
        summaryRaw: previousSummaryRaw,
        dailyRaw: previousDailyRaw,
        fallbackCurrency: currentMonth.currency,
      });

  const comparison = buildCostComparisonSummary(currentMonth, previousMonth);

  return {
    status: 'success',
    period: 'MonthToDate',
    resourceGroup: resourceGroup ?? 'unknown',
    currency: currentMonth.currency,
    totalCost: currentMonth.totalCost,
    breakdown: currentMonth.breakdown,
    daily: currentMonth.daily,
    currentMonth,
    previousMonth,
    comparison,
  };
}