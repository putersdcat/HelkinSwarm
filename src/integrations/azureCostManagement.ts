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

interface CostQueryFailure {
  status: 'unavailable' | 'forbidden' | 'error';
  message: string;
  detail?: string;
  throttle?: boolean;
  retryAfterMs?: number;
}

interface CachedCostSummary {
  summary: Extract<AzureCostSummary, { status: 'success' }>;
  fetchedAtMs: number;
}

interface CostSummaryLoadResult {
  summary: AzureCostSummary;
  throttled: boolean;
  retryAfterMs?: number;
}

interface AzureCostUnavailableSummary {
  status: 'unavailable';
  message: string;
  detail?: string;
}

const CostResultSchema = z.object({
  properties: z.object({
    columns: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
    rows: z.array(z.array(z.unknown())).optional(),
  }).optional(),
});

type CostTimeframe =
  | { kind: 'preset'; value: 'MonthToDate' }
  | { kind: 'custom'; from: Date; to: Date };

type CostQueryError = CostQueryFailure;

const COST_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
const COST_SUMMARY_DEFAULT_BACKOFF_MS = 60 * 1000;

let cachedCostSummary: CachedCostSummary | undefined;
let inFlightCostSummary: Promise<AzureCostSummary> | undefined;
let throttleBackoffUntilMs = 0;
let lastThrottleMessage: string | undefined;

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

function parseRetryAfterMs(headers: Headers): number | undefined {
  const retryAfterMs = headers.get('retry-after-ms');
  if (retryAfterMs) {
    const parsedMs = Number(retryAfterMs);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return parsedMs;
    }
  }

  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const parsedSeconds = Number(retryAfter);
    if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
      return parsedSeconds * 1000;
    }
  }

  return undefined;
}

function isCostQueryError(value: unknown): value is CostQueryError {
  return typeof value === 'object' && value !== null && 'status' in value && (
    value.status === 'unavailable' || value.status === 'forbidden' || value.status === 'error'
  );
}

function isSuccessfulCostSummary(
  value: AzureCostSummary,
): value is Extract<AzureCostSummary, { status: 'success' }> {
  return value.status === 'success';
}

function getFreshCachedCostSummary(nowMs: number): Extract<AzureCostSummary, { status: 'success' }> | undefined {
  if (!cachedCostSummary) {
    return undefined;
  }

  if (nowMs - cachedCostSummary.fetchedAtMs >= COST_SUMMARY_CACHE_TTL_MS) {
    return undefined;
  }

  return cachedCostSummary.summary;
}

function getAnyCachedCostSummary(): Extract<AzureCostSummary, { status: 'success' }> | undefined {
  return cachedCostSummary?.summary;
}

function isThrottleFailure(value: unknown): value is CostQueryFailure {
  return isCostQueryError(value) && value.throttle === true;
}

function pickRetryAfterMs(values: ReadonlyArray<unknown>): number | undefined {
  const retryAfterValues = values
    .filter(isThrottleFailure)
    .map((value) => value.retryAfterMs)
    .filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);

  if (retryAfterValues.length === 0) {
    return undefined;
  }

  return Math.max(...retryAfterValues);
}

function buildThrottledSummary(retryAfterMs?: number, message?: string): AzureCostUnavailableSummary {
  const effectiveRetryAfterMs = retryAfterMs ?? COST_SUMMARY_DEFAULT_BACKOFF_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil(effectiveRetryAfterMs / 1000));
  return {
    status: 'unavailable',
    message: message ?? `Cost Management API is throttling requests right now. Please retry in about ${retryAfterSeconds}s.`,
    detail: `Backoff active for approximately ${retryAfterSeconds}s after a 429 response.`,
  };
}

export function resetAzureCostManagementCacheForTests(): void {
  cachedCostSummary = undefined;
  inFlightCostSummary = undefined;
  throttleBackoffUntilMs = 0;
  lastThrottleMessage = undefined;
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

async function queryCostManagement(body: Record<string, unknown>): Promise<unknown | CostQueryFailure> {
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
      } satisfies CostQueryFailure;
    }
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers) ?? COST_SUMMARY_DEFAULT_BACKOFF_MS;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return {
        status: 'unavailable',
        message: `Cost Management API: 429 Too Many Requests. Backing off repeated reads for about ${retryAfterSeconds}s.`,
        detail: text.substring(0, 400),
        throttle: true,
        retryAfterMs,
      } satisfies CostQueryFailure;
    }
    return {
      status: 'error',
      message: `Cost Management API: ${response.status} ${response.statusText}`,
      detail: text.substring(0, 400),
    } satisfies CostQueryFailure;
  }

  return response.json() as Promise<unknown>;
}

async function loadAzureResourceGroupCostSummary(): Promise<CostSummaryLoadResult> {
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

  const throttled = [currentSummaryRaw, currentDailyRaw, previousSummaryRaw, previousDailyRaw].some(isThrottleFailure);
  const retryAfterMs = pickRetryAfterMs([currentSummaryRaw, currentDailyRaw, previousSummaryRaw, previousDailyRaw]);

  if (isCostQueryError(currentSummaryRaw)) {
    return {
      summary: currentSummaryRaw,
      throttled,
      retryAfterMs,
    };
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
    return {
      summary: { status: 'error', message: 'Unexpected Cost Management API response shape.' },
      throttled,
      retryAfterMs,
    };
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
    summary: {
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
    },
    throttled,
    retryAfterMs,
  };
}

export async function getAzureResourceGroupCostSummary(): Promise<AzureCostSummary> {
  const nowMs = Date.now();
  const freshCachedSummary = getFreshCachedCostSummary(nowMs);
  if (freshCachedSummary) {
    return freshCachedSummary;
  }

  if (nowMs < throttleBackoffUntilMs) {
    const cachedSummary = getAnyCachedCostSummary();
    if (cachedSummary) {
      return cachedSummary;
    }

    return buildThrottledSummary(throttleBackoffUntilMs - nowMs, lastThrottleMessage);
  }

  if (inFlightCostSummary) {
    return await inFlightCostSummary;
  }

  inFlightCostSummary = (async () => {
    const loadResult = await loadAzureResourceGroupCostSummary();

    if (loadResult.throttled) {
      const effectiveRetryAfterMs = loadResult.retryAfterMs ?? COST_SUMMARY_DEFAULT_BACKOFF_MS;
      throttleBackoffUntilMs = Math.max(throttleBackoffUntilMs, Date.now() + effectiveRetryAfterMs);
      if (isCostQueryError(loadResult.summary)) {
        lastThrottleMessage = loadResult.summary.message;
      }

      const cachedSummary = getAnyCachedCostSummary();
      if (cachedSummary) {
        console.warn('[azureCostManagement] Reusing cached cost summary after Cost Management API throttling');
        return cachedSummary;
      }
    } else {
      throttleBackoffUntilMs = 0;
      lastThrottleMessage = undefined;
    }

    if (isSuccessfulCostSummary(loadResult.summary)) {
      cachedCostSummary = {
        summary: loadResult.summary,
        fetchedAtMs: Date.now(),
      };
    }

    if (loadResult.throttled && isCostQueryError(loadResult.summary)) {
      return buildThrottledSummary(loadResult.retryAfterMs, loadResult.summary.message);
    }

    return loadResult.summary;
  })();

  try {
    return await inFlightCostSummary;
  } finally {
    inFlightCostSummary = undefined;
  }
}