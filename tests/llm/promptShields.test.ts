import { afterEach, describe, expect, it, vi } from 'vitest';

const telemetryHarness = vi.hoisted(() => ({
  getBearerToken: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('../../src/auth/identity.js', () => ({
  getBearerToken: telemetryHarness.getBearerToken,
}));

vi.mock('../../src/observability/telemetry.js', () => ({
  trackEvent: telemetryHarness.trackEvent,
}));

async function loadPromptShieldsWithEnv(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  telemetryHarness.getBearerToken.mockReset();
  telemetryHarness.trackEvent.mockReset();

  process.env['MicrosoftAppId'] = 'test-app-id';
  process.env['MicrosoftAppTenantId'] = 'test-tenant-id';

  delete process.env['LLM_PROVIDER'];
  delete process.env['AZURE_CONTENT_SAFETY_ENDPOINT'];

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return import('../../src/llm/promptShields.js');
}

describe('promptShields provider-aware behavior', () => {
  afterEach(() => {
    delete process.env['LLM_PROVIDER'];
    delete process.env['AZURE_CONTENT_SAFETY_ENDPOINT'];
    vi.resetModules();
  });

  it('bypasses Azure Prompt Shields when the active provider is OpenRouter', async () => {
    const { promptShields } = await loadPromptShieldsWithEnv({
      LLM_PROVIDER: 'openrouter',
      AZURE_CONTENT_SAFETY_ENDPOINT: 'https://safety.example.com',
    });

    const result = await promptShields.check('hello world', 'corr-openrouter');

    expect(result.clean).toBe(true);
    expect(result.mode).toBe('provider-bypassed');
    expect(telemetryHarness.getBearerToken).not.toHaveBeenCalled();
    expect(telemetryHarness.trackEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'PromptShieldResult',
      correlationId: 'corr-openrouter',
      properties: expect.objectContaining({
        provider: 'openrouter',
        mode: 'provider-bypassed',
        blocked: false,
      }),
    }));
  });

  it('reports not-configured fail-open when Azure provider has no content safety endpoint', async () => {
    const { promptShields } = await loadPromptShieldsWithEnv({
      LLM_PROVIDER: 'azure',
      AZURE_CONTENT_SAFETY_ENDPOINT: undefined,
    });

    const result = await promptShields.check('hello world', 'corr-no-endpoint');

    expect(result.clean).toBe(true);
    expect(result.mode).toBe('not-configured');
    expect(telemetryHarness.getBearerToken).not.toHaveBeenCalled();
    expect(telemetryHarness.trackEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'PromptShieldResult',
      correlationId: 'corr-no-endpoint',
      properties: expect.objectContaining({
        provider: 'azure',
        mode: 'not-configured',
      }),
    }));
  });
});