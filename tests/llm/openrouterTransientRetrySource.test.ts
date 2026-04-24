// Source-pinning lock for [#677] same-model transient-retry policy.
//
// Guards the per-slot one-shot retry on 408/502/503/524 in
// `src/llm/foundryClient.ts`. Behaviour:
// - Per-slot Set<number> tracks which chain positions have already retried
// - Only OpenRouter (`usesObo === false`)
// - 500ms fixed backoff, then `i--; continue;` to re-enter the same slot
// - Skipped if remaining budget < backoff + 1000ms safety margin
// - Emits `OpenRouterTransientRetry` telemetry on each retry attempt
//
// Without these locks, future refactors could silently:
// - Re-declare `transientRetriedSlots` inside the loop (would re-retry
//   forever on a 502 cascade until budget burned, never reaching fallback)
// - Drop the budget guard (would let the retry consume the entire budget)
// - Forget the OpenRouter-only guard (would inject retry into Azure path)

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FOUNDRY_CLIENT_SRC = readFileSync(
  resolve(__dirname, '../../src/llm/foundryClient.ts'),
  'utf-8',
);
const TELEMETRY_SRC = readFileSync(
  resolve(__dirname, '../../src/observability/telemetry.ts'),
  'utf-8',
);

describe('[#677] OpenRouter transient-retry source pinning', () => {
  it('declares chain-scoped transientRetriedSlots Set<number> with #677 rationale', () => {
    expect(FOUNDRY_CLIENT_SRC).toContain('[#677]');
    expect(FOUNDRY_CLIENT_SRC).toContain('transientRetriedSlots');
    expect(FOUNDRY_CLIENT_SRC).toMatch(
      /const\s+transientRetriedSlots\s*=\s*new Set<number>\(\)/,
    );
  });

  it('CHAIN-SCOPED comment present (regression-prone re-declaration guard)', () => {
    expect(FOUNDRY_CLIENT_SRC).toMatch(
      /CHAIN-\s*\n?\s*\/\/\s*SCOPED for the same reason as grok429RetryDone/,
    );
  });

  it('retry branch matches all four documented transient status codes (408/502/503/524)', () => {
    expect(FOUNDRY_CLIENT_SRC).toMatch(
      /err\.statusCode === 408 \|\| err\.statusCode === 502 \|\| err\.statusCode === 503 \|\| err\.statusCode === 524/,
    );
  });

  it('retry branch is gated to OpenRouter only (`usesObo === false`)', () => {
    // Match the predicate that lives inside the transient-retry block.
    const block = FOUNDRY_CLIENT_SRC.split('Same-model retry on transient upstream blip')[1];
    expect(block).toBeDefined();
    expect(block.split('continue;')[0]).toContain('routing.usesObo === false');
  });

  it('per-slot once-only guard via transientRetriedSlots.has(i) before retry', () => {
    expect(FOUNDRY_CLIENT_SRC).toContain('!transientRetriedSlots.has(i)');
    expect(FOUNDRY_CLIENT_SRC).toContain('transientRetriedSlots.add(i)');
  });

  it('remaining budget guard: only retry if remainingBudgetMs > TRANSIENT_RETRY_BACKOFF_MS + 1000', () => {
    expect(FOUNDRY_CLIENT_SRC).toContain('TRANSIENT_RETRY_BACKOFF_MS = 500');
    expect(FOUNDRY_CLIENT_SRC).toMatch(
      /remainingBudgetMs > TRANSIENT_RETRY_BACKOFF_MS \+ 1000/,
    );
  });

  it('fixed 500ms backoff via setTimeout then i-- continue (re-enters same slot)', () => {
    const block = FOUNDRY_CLIENT_SRC.split('Same-model retry on transient upstream blip')[1];
    expect(block).toBeDefined();
    const firstContinue = block.split('continue;')[0];
    expect(firstContinue).toMatch(/setTimeout\(resolve, TRANSIENT_RETRY_BACKOFF_MS\)/);
    expect(firstContinue).toContain('i--');
  });

  it('emits OpenRouterTransientRetry telemetry with model + statusCode + errorClass', () => {
    expect(FOUNDRY_CLIENT_SRC).toContain("name: 'OpenRouterTransientRetry'");
    const block = FOUNDRY_CLIENT_SRC.split("name: 'OpenRouterTransientRetry'")[1];
    expect(block).toBeDefined();
    const props = block.split('});')[0];
    expect(props).toContain('model: routing.deploymentName');
    expect(props).toContain('statusCode: err.statusCode');
    expect(props).toContain('errorClass: err.errorClass');
    expect(props).toContain('backoffMs: TRANSIENT_RETRY_BACKOFF_MS');
  });

  it('OpenRouterTransientRetry registered in TelemetryEventName union', () => {
    expect(TELEMETRY_SRC).toContain("'OpenRouterTransientRetry'");
  });
});
