// Budget skill handlers — Azure spend tracking and token budget estimation.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md §4.6
// Issue: #242

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Model rate table — USD per 1M tokens
// Mirrors the blended rate table in src/orchestrator/turnTelemetry.ts.
// Update both when new models are added.
// ---------------------------------------------------------------------------

interface ModelRate {
  /** USD per 1M input (prompt) tokens */
  input: number;
  /** USD per 1M output (completion) tokens */
  output: number;
  /** USD per 1M tokens, blended input+output average */
  blended: number;
  /** Human-readable label */
  label: string;
}

const MODEL_RATES: Record<string, ModelRate> = {
  'x-ai/grok-4.1-fast': {
    input: 3.00, output: 5.00, blended: 4.00, label: 'Grok 4.1 Fast (default)',
  },
  'grok-4-1-fast-non-reasoning': {
    input: 3.00, output: 5.00, blended: 4.00, label: 'Grok 4.1 Fast (non-reasoning)',
  },
  'grok-4-1-fast-reasoning': {
    input: 10.00, output: 14.00, blended: 12.00, label: 'Grok 4.1 Fast (reasoning)',
  },
  'o4-mini': {
    input: 1.10, output: 4.40, blended: 2.40, label: 'GPT o4-mini',
  },
  'gpt-5': {
    input: 10.00, output: 26.00, blended: 18.00, label: 'GPT-5',
  },
  'DeepSeek-V3.2': {
    input: 0.27, output: 1.10, blended: 1.00, label: 'DeepSeek V3.2',
  },
  'FW-MiniMax-M2.5': {
    input: 0.80, output: 3.20, blended: 2.00, label: 'MiniMax M2.5',
  },
  'FW-Kimi-K2.5': {
    input: 0.50, output: 3.50, blended: 2.00, label: 'Kimi K2.5',
  },
};

/** Average blended tokens per conversational turn (input + output). */
const AVG_TOKENS_PER_TURN = 2500;

/** Resolve a model key to a ModelRate entry via exact match or partial/alias match. */
function resolveRate(modelKey: string): ModelRate | undefined {
  if (MODEL_RATES[modelKey]) return MODEL_RATES[modelKey];

  // Fuzzy search: lowercase partial
  const lower = modelKey.toLowerCase();
  const hit = Object.entries(MODEL_RATES).find(
    ([k]) => lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower),
  );
  return hit?.[1];
}

// ---------------------------------------------------------------------------
// budget_get_status
// ---------------------------------------------------------------------------

export const budget_get_status: ToolHandler = async (_args) => {
  const { getAzureResourceGroupCostSummary } = await import(
    '../../src/integrations/azureCostManagement.js'
  );

  const summary = await getAzureResourceGroupCostSummary();

  if (summary.status !== 'success') {
    return {
      status: summary.status,
      message: summary.message,
      detail: (summary as { detail?: string }).detail,
    };
  }

  const { totalCost, currency, currentMonth, comparison } = summary;
  const prevTotal =
    summary.previousMonth.status === 'success' || summary.previousMonth.status === 'unavailable'
      ? summary.previousMonth.totalCost
      : undefined;

  // Active primary model from env (used as the reference model for rate display)
  const primaryModel = process.env['LLM_PRIMARY_MODEL'] ?? 'x-ai/grok-4.1-fast';
  const primaryRate = resolveRate(primaryModel);

  return {
    status: 'success',
    period: 'MonthToDate',
    currency,
    currentMonthSpend: totalCost,
    periodLabel:
      currentMonth.status === 'success' || currentMonth.status === 'unavailable'
        ? currentMonth.label
        : undefined,
    daysInMonth:
      currentMonth.status === 'success' || currentMonth.status === 'unavailable'
        ? currentMonth.daysInMonth
        : undefined,
    dailyVelocity: comparison.status === 'available' ? comparison.currentVelocity : null,
    projectedMonthEnd:
      comparison.status === 'available' ? comparison.projectedMonthEndCost : null,
    previousMonthTotal: prevTotal,
    spendDeltaPercent:
      comparison.status === 'available' ? comparison.spendDeltaPercent : null,
    primaryModel,
    primaryModelRateUsdPerMTokens: primaryRate
      ? { input: primaryRate.input, output: primaryRate.output, blended: primaryRate.blended }
      : null,
  };
};

// ---------------------------------------------------------------------------
// budget_estimate_tokens
// ---------------------------------------------------------------------------

const EstimateArgsSchema = z.object({
  usd_budget: z.number().positive(),
  model: z.string().optional(),
  mode: z.enum(['input', 'output', 'blended']).optional().default('blended'),
});

export const budget_estimate_tokens: ToolHandler = async (args) => {
  const parsed = EstimateArgsSchema.parse(args);
  const { usd_budget, mode } = parsed;

  // Default to current primary model
  const modelKey =
    parsed.model ?? process.env['LLM_PRIMARY_MODEL'] ?? 'x-ai/grok-4.1-fast';

  const rateEntry = resolveRate(modelKey);

  if (!rateEntry) {
    return {
      status: 'unknown_model',
      model: modelKey,
      usd_budget,
      message: `No rate data found for model '${modelKey}'. Known models: ${Object.keys(MODEL_RATES).join(', ')}.`,
    };
  }

  const ratePerToken = rateEntry[mode] / 1_000_000;
  const estimatedTokens = Math.floor(usd_budget / ratePerToken);
  const estimatedTurns = Math.floor(estimatedTokens / AVG_TOKENS_PER_TURN);

  return {
    status: 'success',
    model: modelKey,
    modelLabel: rateEntry.label,
    usd_budget,
    mode,
    rate_per_million_tokens: rateEntry[mode],
    estimated_total_tokens: estimatedTokens,
    estimated_turns: estimatedTurns,
    note: `Estimate based on ~${AVG_TOKENS_PER_TURN.toLocaleString()} blended tokens per conversational turn. Actual usage varies with message complexity.`,
  };
};
