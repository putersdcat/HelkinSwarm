// Unit test for #677 OpenRouter provider routing env wiring.
// Tests the loader behavior end-to-end via process.env so the
// `parseBooleanEnv("false") === false` footgun is locked in.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBooleanEnv } from '../../src/config/booleanEnv.js';

describe('OpenRouter provider routing env parser (#677)', () => {
  // Sanity: the underlying boolean parser. The whole reason we route through
  // parseBooleanEnv instead of z.coerce.boolean is this exact invariant.
  it('parseBooleanEnv("false") returns false (NOT true)', () => {
    expect(parseBooleanEnv('false')).toBe(false);
  });

  it('parseBooleanEnv("true") returns true', () => {
    expect(parseBooleanEnv('true')).toBe(true);
  });

  it('parseBooleanEnv(undefined) returns false', () => {
    expect(parseBooleanEnv(undefined)).toBe(false);
  });
});

describe('envConfig OpenRouter provider routing loader (#677)', () => {
  const ENV_KEYS = [
    'OPENROUTER_PROVIDER_ORDER',
    'OPENROUTER_ALLOW_FALLBACKS',
    'MicrosoftAppId',
    'MicrosoftAppTenantId',
  ];
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {};
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
    // Required-by-schema fields the loader needs to succeed at all.
    process.env['MicrosoftAppId'] = 'test-app-id';
    process.env['MicrosoftAppTenantId'] = 'test-tenant-id';
    delete process.env['OPENROUTER_PROVIDER_ORDER'];
    delete process.env['OPENROUTER_ALLOW_FALLBACKS'];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const v = originalEnv[key];
      if (v === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = v;
      }
    }
  });

  it('default openrouterAllowFallbacks=true and openrouterProviderOrder=undefined', async () => {
    const { resetEnvConfigForTest, getEnvConfig } = await import('../../src/config/envConfig.js');
    resetEnvConfigForTest();
    const cfg = getEnvConfig();
    expect(cfg.openrouterAllowFallbacks).toBe(true);
    expect(cfg.openrouterProviderOrder).toBeUndefined();
  });

  it('OPENROUTER_ALLOW_FALLBACKS="false" loads as false (z.coerce.boolean footgun guard)', async () => {
    process.env['OPENROUTER_ALLOW_FALLBACKS'] = 'false';
    const { resetEnvConfigForTest, getEnvConfig } = await import('../../src/config/envConfig.js');
    resetEnvConfigForTest();
    const cfg = getEnvConfig();
    expect(cfg.openrouterAllowFallbacks).toBe(false);
  });

  it('OPENROUTER_ALLOW_FALLBACKS="true" loads as true', async () => {
    process.env['OPENROUTER_ALLOW_FALLBACKS'] = 'true';
    const { resetEnvConfigForTest, getEnvConfig } = await import('../../src/config/envConfig.js');
    resetEnvConfigForTest();
    const cfg = getEnvConfig();
    expect(cfg.openrouterAllowFallbacks).toBe(true);
  });

  it('OPENROUTER_PROVIDER_ORDER passes through verbatim for callOpenRouter to split', async () => {
    process.env['OPENROUTER_PROVIDER_ORDER'] = 'xai,fireworks';
    const { resetEnvConfigForTest, getEnvConfig } = await import('../../src/config/envConfig.js');
    resetEnvConfigForTest();
    const cfg = getEnvConfig();
    expect(cfg.openrouterProviderOrder).toBe('xai,fireworks');
  });
});
