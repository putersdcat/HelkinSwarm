// Turn-level debug telemetry — captures timings and formats a compact footer.
// Spec ref: 0n-Turn-by-Turn-Debug-Telemetry.md
// ADDENDA: ADDENDA-01-Turn-Telemetry-and-Correlation-ID-System.md

import type { EnvConfig } from '../config/envConfig.js';

export type TelemetryMode = 'off' | 'minimal' | 'standard' | 'verbose';

export interface TelemetrySpan {
  label: string;
  durationMs: number;
}

export interface TurnTelemetryData {
  correlationId: string;
  /** Absolute UTC timestamp for when the footer was generated/sent. */
  timestampIso?: string;
  totalMs: number;
  model: string;
  modelSequence?: string[];
  promptTokens: number;
  completionTokens: number;
  spans: TelemetrySpan[];
  toolCalls: string[];
  safetyPassed: boolean;
  /** Request complexity from planning phase (#320). */
  planComplexity?: 'simple' | 'compound' | 'complex';
  /** Number of sub-agent sessions spawned this turn (#321). */
  subAgentCount?: number;
  /** Number of scoped tokens successfully minted across execution paths this turn (#321). */
  scopedTokenMintCount?: number;
  /** Exact provider-reported turn cost when available (e.g. OpenRouter usage.cost). */
  providerCost?: number;
  providerCostUnit?: 'credits';
  providerCostDetails?: Record<string, number>;
  /** Per-agent breakdown for swarm turns (#636). */
  swarmAgentBreakdown?: SwarmAgentTelemetry[];
  /** Decomposer token cost, separate from worker/leader totals (#636). */
  decomposerTokens?: number;
  /** Leader synthesis token cost (#636). */
  leaderTokens?: number;
  /** OpenRouter server-side web search requests this turn (#650 AC-3). */
  webSearchRequests?: number;
}

/** Per-agent telemetry for swarm footer rendering (#636). */
export interface SwarmAgentTelemetry {
  agent: string;
  tokens: number;
  durationMs: number;
  toolCalls: number;
  success: boolean;
}

// USD per 1M tokens (blended input/output average). (#254, #260)
const MODEL_COST_USD_PER_M: Record<string, number> = {
  'gpt-5': 18.00,
  'o4-mini': 2.40,
  'o3': 24.00,
  'grok-4-1-fast-non-reasoning': 4.00,
  'grok-4-1-fast-reasoning': 12.00,
  'DeepSeek-V3.2': 1.00,
  'FW-MiniMax-M2.5': 2.00,
  'FW-Kimi-K2.5': 2.00,
};

// Approved money emoji rotation set. (#260)
const MONEY_EMOJIS = ['💲', '💵', '💸', '🤑', '🪙'] as const;

/**
 * Pick a deterministic money emoji from the approved set based on the correlation ID.
 * This keeps the same turn's footer consistent while rotating across turns.
 */
function getMoneyEmoji(correlationId: string): string {
  const idx = correlationId.charCodeAt(0) % MONEY_EMOJIS.length;
  return MONEY_EMOJIS[idx] ?? '💵';
}

// Container startup timestamp for uptime display. (#254)
const STARTUP_TIME = Date.now();

/**
 * Estimate EUR cost for a given model and total token count.
 * Returns undefined if the model is not in the cost table.
 */
export function estimateCostUsd(model: string, totalTokens: number): number | undefined {
  // Try exact match first, then longest-prefix match for versioned deployment names
  let rate = MODEL_COST_USD_PER_M[model];
  if (rate === undefined) {
    const lowerModel = model.toLowerCase();
    const key = Object.keys(MODEL_COST_USD_PER_M)
      .filter((k) => lowerModel.startsWith(k.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (key) rate = MODEL_COST_USD_PER_M[key];
  }
  if (rate === undefined) return undefined;
  return (totalTokens / 1_000_000) * rate;
}

/** @deprecated Use estimateCostUsd instead */
export const estimateCostEur = estimateCostUsd;

function formatProviderCost(amount: number, unit: 'credits'): string {
  switch (unit) {
    case 'credits':
      return `${amount.toFixed(4)}cr`;
  }
}

function resolveTelemetryCostDisplay(data: TurnTelemetryData): string {
  if (data.providerCost !== undefined && data.providerCostUnit) {
    return formatProviderCost(data.providerCost, data.providerCostUnit);
  }

  const totalTokens = data.promptTokens + data.completionTokens;
  const cost = estimateCostUsd(data.model, totalTokens);
  return cost !== undefined ? `$${cost.toFixed(4)}` : '$?';
}

/**
 * Format uptime since container startup as compact human-readable string.
 */
export function formatUptime(nowMs?: number): string {
  const elapsed = (nowMs ?? Date.now()) - STARTUP_TIME;
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours}h${remainMin}m` : `${hours}h`;
}

/**
 * Format an ISO timestamp for compact footer/debug display.
 * Drops milliseconds but preserves full UTC date + time ordering.
 */
export function formatTelemetryTimestamp(timestampIso: string | undefined): string | undefined {
  if (!timestampIso) {
    return undefined;
  }

  const parsed = new Date(timestampIso);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Returns true when the actual model satisfies the user's direct `/model` request.
 * Azure model identifiers often include a version/date suffix, so prefix matches count.
 */
export function doesActualModelSatisfyRequestedOverride(
  requestedModel: string,
  actualModel: string,
): boolean {
  const requested = requestedModel.trim().toLowerCase();
  const actual = actualModel.trim().toLowerCase();

  return actual === requested || actual.startsWith(`${requested}-`);
}

/**
 * Build a user-visible disclosure when a direct `/model` request silently fell back.
 */
export function buildModelOverrideDisclosure(
  requestedModel: string | undefined,
  actualModel: string,
): string {
  if (!requestedModel || requestedModel === 'primary' || requestedModel === 'secondary') {
    return '';
  }

  if (doesActualModelSatisfyRequestedOverride(requestedModel, actualModel)) {
    return '';
  }

  return `⚠️ Requested \`${requestedModel}\`, but this turn completed on \`${actualModel}\` after fallback.`;
}

/**
 * Format a compact telemetry footer string for appending to bot replies.
 * In 'off' mode, still appends a minimal correlation ID suffix for traceability.
 *
 * Modes:
 *  - off:      `[corr:abc12345]`
 *  - minimal:  `[E2E:1234ms|m:grok-4.1f|�$0.02|🕐1h23m]`
 *  - standard: `[E2E:1234ms|m:grok-4.1f|pt:800|ct:200|tools:2|💵$0.02|🕐1h23m|corr:abc12345]`
 *  - verbose:  full breakdown with spans, tool names, safety, cost, uptime, correlation
 */
export function formatTelemetryFooter(
  mode: TelemetryMode,
  data: TurnTelemetryData,
): string {
  const shortCorr = data.correlationId.slice(0, 8);

  if (mode === 'off') {
    return `\n\n\`[corr:${shortCorr}]\``;
  }

  const shortModel = abbreviateModel(data.model);
  const costStr = resolveTelemetryCostDisplay(data);
  const moneyEmoji = getMoneyEmoji(data.correlationId);
  const uptime = formatUptime();
  const timestamp = formatTelemetryTimestamp(data.timestampIso);

  if (mode === 'minimal') {
    const timePart = timestamp ? `|ts:${timestamp}` : '';
    const line = `[E2E:${data.totalMs}ms|m:${shortModel}${timePart}|${moneyEmoji}${costStr}|🕐${uptime}|corr:${shortCorr}]`;
    return '\n\n---\n`' + line + '`';
  }

  if (mode === 'standard') {
    const extraParts = [
      data.subAgentCount ? `sa:${data.subAgentCount}` : '',
      // Swarm cost split: workers vs leader (#636)
      data.webSearchRequests ? `web:${data.webSearchRequests}` : '',
      data.swarmAgentBreakdown ? `workers:${data.swarmAgentBreakdown.reduce((s, a) => s + a.tokens, 0)}t` : '',
      data.leaderTokens !== undefined ? `leader:${data.leaderTokens}t` : '',
      data.decomposerTokens ? `decomp:${data.decomposerTokens}t` : '',
      data.scopedTokenMintCount ? `tok:${data.scopedTokenMintCount}` : '',
      data.planComplexity && data.planComplexity !== 'simple' ? `plan:${data.planComplexity}` : '',
      timestamp ? `ts:${timestamp}` : '',
    ].filter(Boolean).join('|');
    const extra = extraParts ? `|${extraParts}` : '';
    const line = `[E2E:${data.totalMs}ms|m:${shortModel}|pt:${data.promptTokens}|ct:${data.completionTokens}|tools:${data.toolCalls.length}${extra}|${moneyEmoji}${costStr}|🕐${uptime}|corr:${shortCorr}]`;
    return '\n\n---\n`' + line + '`';
  }

  // verbose
  const parts: string[] = [
    `E2E:${data.totalMs}ms`,
    `m:${shortModel}`,
    `pt:${data.promptTokens}`,
    `ct:${data.completionTokens}`,
  ];

  if (data.modelSequence && data.modelSequence.length > 1) {
    parts.push(`models:${data.modelSequence.map(abbreviateModel).join('→')}`);
  }

  // Add span breakdowns
  for (const span of data.spans) {
    parts.push(`${span.label}:${span.durationMs}ms`);
  }

  // Tool call details
  parts.push(
    data.toolCalls.length > 0
      ? `tools:${data.toolCalls.join(',')}`
      : 'tools:0',
  );

  parts.push(`safe:${data.safetyPassed ? '✓' : '✗'}`);
  if (data.webSearchRequests) parts.push(`web:${data.webSearchRequests}`);
  if (data.subAgentCount) parts.push(`sa:${data.subAgentCount}`);

  // Per-agent swarm breakdown (#636)
  if (data.decomposerTokens) parts.push(`decomp:${data.decomposerTokens}t`);
  if (data.swarmAgentBreakdown) {
    for (const a of data.swarmAgentBreakdown) {
      const durSec = Math.round(a.durationMs / 1000);
      parts.push(`${a.agent}:${a.tokens}t(${durSec}s,${a.toolCalls}tools${a.success ? '✓' : '✗'})`);
    }
  }
  if (data.leaderTokens !== undefined) parts.push(`leader:${data.leaderTokens}t`);

  if (data.scopedTokenMintCount) parts.push(`tok:${data.scopedTokenMintCount}`);
  if (data.planComplexity && data.planComplexity !== 'simple') parts.push(`plan:${data.planComplexity}`);
  if (timestamp) parts.push(`ts:${timestamp}`);
  if (data.providerCostUnit === 'credits' && data.providerCostDetails?.['upstream_inference_cost'] !== undefined) {
    parts.push(`up:${formatProviderCost(data.providerCostDetails['upstream_inference_cost'], 'credits')}`);
  }
  parts.push(`${moneyEmoji}${costStr}`);
  parts.push(`🕐${uptime}`);
  parts.push(`corr:${shortCorr}`);

  const line = `[${parts.join('|')}]`;
  return '\n\n---\n`' + line + '`';
}

/**
 * Check if telemetry should be appended for the current config.
 */
export function isTelemetryEnabled(config: Pick<EnvConfig, 'devTelemetryMode'>): boolean {
  return config.devTelemetryMode !== 'off';
}

/**
 * Shorten model names for compact display.
 */
function abbreviateModel(model: string): string {
  // Common abbreviations
  return model
    .replace(/o4-mini[-\d]*/g, 'o4m')
    .replace('grok-4-1-fast-non-reasoning', 'grok-4.1f')
    .replace('grok-4-1-non-reasoning', 'grok-4.1')
    .replace('gpt-4.1-mini', 'gpt-4.1m')
    .replace('gpt-4.1-nano', 'gpt-4.1n')
    .replace('text-embedding-3-large', 'emb-3l');
}
