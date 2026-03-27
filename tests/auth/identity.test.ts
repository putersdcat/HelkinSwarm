import { afterEach, describe, expect, it, vi } from 'vitest';

type TokenResult = { token: string; expiresOnTimestamp: number };

async function loadIdentityModuleWithTokenImpl(getTokenImpl: () => Promise<TokenResult | null>) {
  vi.resetModules();

  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';

  vi.doMock('@azure/identity', () => ({
    ManagedIdentityCredential: class {
      getToken = getTokenImpl;
    },
    DefaultAzureCredential: class {
      getToken = getTokenImpl;
    },
  }));

  return import('../../src/auth/identity.js');
}

describe('getBearerToken', () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.doUnmock('@azure/identity');
    vi.resetModules();
    delete process.env['AZURE_CLIENT_ID'];
    delete process.env['MICROSOFT_APP_ID'];
    delete process.env['MICROSOFT_APP_TENANT_ID'];
  });

  it('returns a token when the credential succeeds', async () => {
    process.env['AZURE_CLIENT_ID'] = 'test-client-id';
    const mod = await loadIdentityModuleWithTokenImpl(async () => ({
      token: 'token-123',
      expiresOnTimestamp: Date.now() + 3600_000,
    }));

    await expect(mod.getBearerToken('scope://test/.default')).resolves.toBe('token-123');
  });

  it('times out when credential.getToken hangs indefinitely (#326)', async () => {
    process.env['AZURE_CLIENT_ID'] = 'test-client-id';
    vi.useFakeTimers();
    const mod = await loadIdentityModuleWithTokenImpl(async () => new Promise(() => undefined));

    const tokenPromise = mod.getBearerToken('scope://hung/.default');
    const assertion = expect(tokenPromise).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(8_001);

    await assertion;
  });
});