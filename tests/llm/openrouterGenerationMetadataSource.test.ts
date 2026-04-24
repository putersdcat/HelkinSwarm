// Source-pinning lock test for #677 OpenRouter generation-metadata follow-up.
//
// This is observability code that runs against live OpenRouter on every
// successful chat completion. The wiring is easy to silently break by
// accident (e.g. someone moves the call inside the SSE branch, awaits it,
// or removes the api-key guard). These assertions read the actual source
// and lock the contract so a regression fails CI before deploy.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const FOUNDRY_CLIENT_SRC = readFileSync('src/llm/foundryClient.ts', 'utf8');
const TELEMETRY_SRC = readFileSync('src/observability/telemetry.ts', 'utf8');

describe('OpenRouter generation-metadata follow-up (#677)', () => {
  it('TelemetryEventName union exposes both success and failure events', () => {
    expect(TELEMETRY_SRC).toContain("| 'OpenRouterGenerationMetadata'");
    expect(TELEMETRY_SRC).toContain("| 'OpenRouterGenerationMetadataFailed'");
  });

  it('callOpenRouter schedules the follow-up after mapApiResponse and the detect-* guards', () => {
    // Must run AFTER both detect helpers (mapped must be valid before we trust the id).
    const detectIdx = FOUNDRY_CLIENT_SRC.indexOf('detectOpenRouterEmptyCompletion(mapped');
    const scheduleIdx = FOUNDRY_CLIENT_SRC.indexOf('scheduleOpenRouterGenerationMetadataFetch(');
    expect(detectIdx).toBeGreaterThan(0);
    expect(scheduleIdx).toBeGreaterThan(detectIdx);

    // Must be guarded by both mapped.id and config.openrouterApiKey.
    expect(FOUNDRY_CLIENT_SRC).toContain('if (mapped.id && config.openrouterApiKey) {');
  });

  it('schedule helper is fire-and-forget — never awaited and returns void', () => {
    // The signature must be void-returning so a stray await never compiles.
    expect(FOUNDRY_CLIENT_SRC).toMatch(
      /function\s+scheduleOpenRouterGenerationMetadataFetch\s*\([\s\S]*?\)\s*:\s*void\s*{/,
    );

    // The call site must NOT be prefixed by `await`.
    expect(FOUNDRY_CLIENT_SRC).not.toMatch(/await\s+scheduleOpenRouterGenerationMetadataFetch/);

    // Internal trampoline must defer past the chat response: setImmediate -> setTimeout.
    expect(FOUNDRY_CLIENT_SRC).toContain('setImmediate(() => {');
    expect(FOUNDRY_CLIENT_SRC).toContain(
      'OPENROUTER_GENERATION_METADATA_INITIAL_DELAY_MS',
    );
    expect(FOUNDRY_CLIENT_SRC).toContain('OPENROUTER_GENERATION_METADATA_INITIAL_DELAY_MS = 1500');
    expect(FOUNDRY_CLIENT_SRC).toContain('OPENROUTER_GENERATION_METADATA_TIMEOUT_MS = 5000');
  });

  it('hits /api/v1/generation with id query param and bearer auth', () => {
    expect(FOUNDRY_CLIENT_SRC).toContain("OPENROUTER_GENERATION_API_PATH = '/api/v1/generation'");
    expect(FOUNDRY_CLIENT_SRC).toContain("url.searchParams.set('id', generationId);");
    expect(FOUNDRY_CLIENT_SRC).toContain("'Authorization': `Bearer ${apiKey}`");
  });

  it('uses the same fresh-agent ghost-socket pattern as callOpenRouter', () => {
    // Both code paths run in the same Container Apps host — must not pool.
    const matches = FOUNDRY_CLIENT_SRC.match(/new https\.Agent\(\{ keepAlive: false \}\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('emits OpenRouterGenerationMetadata with the authoritative cost + native-token fields', () => {
    expect(FOUNDRY_CLIENT_SRC).toContain("name: 'OpenRouterGenerationMetadata',");
    // Properties must surface the OpenRouter-only fields the streaming usage
    // block does NOT carry (this is the whole point of the follow-up call).
    expect(FOUNDRY_CLIENT_SRC).toContain('totalCost: payload.total_cost');
    expect(FOUNDRY_CLIENT_SRC).toContain('providerName: payload.provider_name');
    expect(FOUNDRY_CLIENT_SRC).toContain('nativeTokensReasoning: payload.native_tokens_reasoning');
    expect(FOUNDRY_CLIENT_SRC).toContain('nativeTokensCached: payload.native_tokens_cached');
    expect(FOUNDRY_CLIENT_SRC).toContain('latencyMs: payload.latency');
    expect(FOUNDRY_CLIENT_SRC).toContain('generationTimeMs: payload.generation_time');
  });

  it('any failure is silently downgraded to OpenRouterGenerationMetadataFailed (never thrown)', () => {
    expect(FOUNDRY_CLIENT_SRC).toContain("name: 'OpenRouterGenerationMetadataFailed',");
    // The whole fetch helper must be wrapped in try/catch so a throw inside
    // never escapes back to the chat caller.
    expect(FOUNDRY_CLIENT_SRC).toMatch(
      /async function fetchOpenRouterGenerationMetadata[\s\S]*?try\s*{[\s\S]*?}\s*catch\s*\(err\)\s*{[\s\S]*?OpenRouterGenerationMetadataFailed/,
    );
  });
});
