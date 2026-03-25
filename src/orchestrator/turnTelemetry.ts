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
  totalMs: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  spans: TelemetrySpan[];
  toolCalls: string[];
  safetyPassed: boolean;
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
 * Returns empty string if telemetry is off.
 *
 * Modes:
 *  - off:      ''
 *  - minimal:  `[E2E:1234ms|m:grok-4-1]`
 *  - standard: `[E2E:1234ms|m:grok-4-1|pt:800|ct:200|tools:2]`
 *  - verbose:  `[E2E:1234ms|m:grok-4-1|pt:800|ct:200|prompt:120ms|llm:980ms|tools:outlook_send(45ms),graph_read(32ms)|safe:✓|corr:abc123]`
 */
export function formatTelemetryFooter(
  mode: TelemetryMode,
  data: TurnTelemetryData,
): string {
  if (mode === 'off') return '';

  const shortModel = abbreviateModel(data.model);

  if (mode === 'minimal') {
    const line = `[E2E:${data.totalMs}ms|m:${shortModel}]`;
    return '\n\n---\n`' + line + '`';
  }

  if (mode === 'standard') {
    const line = `[E2E:${data.totalMs}ms|m:${shortModel}|pt:${data.promptTokens}|ct:${data.completionTokens}|tools:${data.toolCalls.length}]`;
    return '\n\n---\n`' + line + '`';
  }

  // verbose
  const parts: string[] = [
    `E2E:${data.totalMs}ms`,
    `m:${shortModel}`,
    `pt:${data.promptTokens}`,
    `ct:${data.completionTokens}`,
  ];

  // Add span breakdowns
  for (const span of data.spans) {
    parts.push(`${span.label}:${span.durationMs}ms`);
  }

  // Tool call details
  if (data.toolCalls.length > 0) {
    parts.push(`tools:${data.toolCalls.join(',')}`);
  }

  parts.push(`safe:${data.safetyPassed ? '✓' : '✗'}`);
  parts.push(`corr:${data.correlationId.slice(0, 8)}`);

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
