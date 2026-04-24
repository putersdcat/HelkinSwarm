// Source-pinning lock test for #677 OpenRouter provider routing primitives.
//
// Locks the wiring between envConfig and callOpenRouter so an accidental
// regression (e.g. someone hardcodes provider:{require_parameters:true}
// again, or wires OPENROUTER_ALLOW_FALLBACKS through z.coerce.boolean which
// turns the string "false" into the boolean true) fails in CI before deploy.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const FOUNDRY_CLIENT_SRC = readFileSync('src/llm/foundryClient.ts', 'utf8');
const ENV_CONFIG_SRC = readFileSync('src/config/envConfig.ts', 'utf8');

describe('OpenRouter provider routing primitives wiring (#677)', () => {
  it('envConfig schema declares both new fields', () => {
    expect(ENV_CONFIG_SRC).toContain('openrouterProviderOrder: z.string().optional()');
    expect(ENV_CONFIG_SRC).toContain('openrouterAllowFallbacks: z.boolean().default(true)');
  });

  it('envConfig loader uses parseBooleanEnv (NOT z.coerce.boolean) for the fallbacks flag', () => {
    // z.coerce.boolean() turns the string "false" into the boolean true.
    // That is the exact opposite of what env-driven config needs and would
    // silently disable fallbacks for everyone the moment we set the env var.
    expect(ENV_CONFIG_SRC).toContain("import { parseBooleanEnv } from './booleanEnv.js'");
    expect(ENV_CONFIG_SRC).toContain(
      "openrouterAllowFallbacks: process.env['OPENROUTER_ALLOW_FALLBACKS'] === undefined",
    );
    expect(ENV_CONFIG_SRC).toContain(
      ": parseBooleanEnv(process.env['OPENROUTER_ALLOW_FALLBACKS'])",
    );
    // Hard guard: openrouterAllowFallbacks must NOT use z.coerce.boolean.
    const coerceMatches = ENV_CONFIG_SRC.match(/openrouterAllowFallbacks:\s*z\.coerce\.boolean/);
    expect(coerceMatches).toBeNull();
  });

  it('callOpenRouter loader env wiring lists the new env vars', () => {
    expect(ENV_CONFIG_SRC).toContain("process.env['OPENROUTER_PROVIDER_ORDER']");
    expect(ENV_CONFIG_SRC).toContain("process.env['OPENROUTER_ALLOW_FALLBACKS']");
  });

  it('callOpenRouter builds a single providerHint object that ALWAYS sets require_parameters', () => {
    expect(FOUNDRY_CLIENT_SRC).toContain(
      'const providerHint: Record<string, unknown> = { require_parameters: true };',
    );
    expect(FOUNDRY_CLIENT_SRC).toContain('body.provider = providerHint;');
  });

  it('provider.order is set only when env is non-empty after split+trim+filter', () => {
    expect(FOUNDRY_CLIENT_SRC).toContain('if (config.openrouterProviderOrder) {');
    // Must split on comma, trim each entry, drop empties — otherwise
    // "xai," would become ["xai", ""] which OpenRouter would reject.
    expect(FOUNDRY_CLIENT_SRC).toContain(".split(',')");
    expect(FOUNDRY_CLIENT_SRC).toContain('.map((s) => s.trim())');
    expect(FOUNDRY_CLIENT_SRC).toContain('.filter((s) => s.length > 0)');
    expect(FOUNDRY_CLIENT_SRC).toContain("providerHint['order'] = order;");
  });

  it('provider.allow_fallbacks is set ONLY when env explicitly opts out', () => {
    // Critical: must check `=== false` (not just falsy) so the default `true`
    // never sneaks the field into the request payload. OpenRouter's documented
    // default behavior is allow_fallbacks=true, so we want to omit the field
    // entirely when not opted out.
    expect(FOUNDRY_CLIENT_SRC).toContain('if (config.openrouterAllowFallbacks === false) {');
    expect(FOUNDRY_CLIENT_SRC).toContain("providerHint['allow_fallbacks'] = false;");
  });

  it('the old hardcoded provider line is gone (no regression to pre-#677 wiring)', () => {
    expect(FOUNDRY_CLIENT_SRC).not.toContain(
      'body.provider = { require_parameters: true };',
    );
  });
});
