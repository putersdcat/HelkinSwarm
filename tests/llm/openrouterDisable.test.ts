import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeRemoteErrorText } from '../../src/llm/foundryClient.js';

async function loadModelRouterWithEnv(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();

  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
  process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://foundry.example.com';
  process.env['LLM_PRIMARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_SECONDARY_MODEL'] = 'grok-4-1-fast-non-reasoning';
  process.env['LLM_FALLBACK_PRIMARY'] = 'gpt-5.4-mini';

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return import('../../src/llm/modelRouter.js');
}

describe('OpenRouter runtime disablement (#286)', () => {
  afterEach(() => {
    delete process.env['LLM_PROVIDER'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['EU_RESIDENCY_MODE'];
    vi.resetModules();
  });

  it('ignores explicit openrouter routing override and returns Azure routing', async () => {
    const modelRouter = await loadModelRouterWithEnv();
    const routing = modelRouter.getModelRouting('openrouter');

    expect(routing.laneName).toBe('global');
    expect(routing.apiBase).toBe('https://foundry.example.com');
    expect(routing.usesObo).toBe(true);
  });

  it('does not enter an OpenRouter lane when LLM_PROVIDER=openrouter is set', async () => {
    const modelRouter = await loadModelRouterWithEnv({ LLM_PROVIDER: 'openrouter' });
    const routing = modelRouter.getModelRouting();

    expect(routing.laneName).toBe('global');
    expect(routing.apiBase).toBe('https://foundry.example.com');
    expect(routing.deploymentName).toBe('grok-4-1-fast-non-reasoning');
  });

  it('does not append OpenRouter as a last-resort fallback even when OPENROUTER_API_KEY is set', async () => {
    const modelRouter = await loadModelRouterWithEnv({ OPENROUTER_API_KEY: 'test-openrouter-key' });
    const chain = modelRouter.getFallbackChain();

    expect(chain.every((entry) => !entry.apiBase.includes('openrouter.ai'))).toBe(true);
    expect(chain.every((entry) => entry.laneName !== 'global' || entry.usesObo)).toBe(true);
  });

  it('uses configured fallback primary when primary and secondary collapse to the same deployment', async () => {
    const modelRouter = await loadModelRouterWithEnv({
      LLM_PRIMARY_MODEL: 'grok-4-1-fast-non-reasoning',
      LLM_SECONDARY_MODEL: 'grok-4-1-fast-non-reasoning',
      LLM_FALLBACK_PRIMARY: 'gpt-5.4-mini',
    });

    const chain = modelRouter.getFallbackChain('grok-4-1-fast-non-reasoning');

    expect(chain.map((entry) => entry.deploymentName)).toEqual([
      'grok-4-1-fast-non-reasoning',
      'gpt-5.4-mini',
    ]);
  });
});

describe('sanitizeRemoteErrorText', () => {
  it('collapses HTML/JS/CSS page junk into a concise omitted-body message', () => {
    const raw = 'Not Found | OpenRouter window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag(\'js\', new Date()); :root { --bprogress-color: hsl(var(--primary)); }';
    const sanitized = sanitizeRemoteErrorText(raw, 300);

    expect(sanitized).toContain('Not Found');
    expect(sanitized).toContain('HTML error page');
    expect(sanitized).not.toContain('window.dataLayer');
    expect(sanitized).not.toContain('gtag(');
    expect(sanitized).not.toContain(':root');
  });

  it('preserves plain-text provider errors when they are not HTML-like', () => {
    const raw = 'rate limit exceeded for this deployment';
    expect(sanitizeRemoteErrorText(raw, 300)).toBe(raw);
  });
});