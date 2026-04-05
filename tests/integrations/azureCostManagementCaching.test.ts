import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  getBearerToken: vi.fn(),
  getEnvConfig: vi.fn(),
}));

vi.mock('../../src/auth/identity.js', () => ({
  getBearerToken: harness.getBearerToken,
}));

vi.mock('../../src/config/envConfig.js', () => ({
  getEnvConfig: harness.getEnvConfig,
}));

async function loadModule() {
  vi.resetModules();
  harness.getBearerToken.mockReset();
  harness.getEnvConfig.mockReset();

  harness.getBearerToken.mockResolvedValue('test-token');
  harness.getEnvConfig.mockReturnValue({
    azureSubscriptionId: 'sub-123',
    azureResourceGroup: 'rg-helkinswarm-a7f2',
  });

  const mod = await import('../../src/integrations/azureCostManagement.js');
  mod.resetAzureCostManagementCacheForTests();
  return mod;
}

function buildCostResponse(rows: unknown[][], columns: Array<{ name: string; type: string }>) {
  return new Response(JSON.stringify({
    properties: {
      columns,
      rows,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildSuccessFetchMock() {
  return vi.fn()
    .mockResolvedValueOnce(buildCostResponse(
      [
        [10, 'USD', 'Foundry Models'],
        [5, 'USD', 'Storage'],
      ],
      [
        { name: 'Cost', type: 'Number' },
        { name: 'Currency', type: 'String' },
        { name: 'ServiceName', type: 'String' },
      ],
    ))
    .mockResolvedValueOnce(buildCostResponse(
      [
        [6, 20260401, 'USD'],
        [9, 20260402, 'USD'],
      ],
      [
        { name: 'Cost', type: 'Number' },
        { name: 'UsageDate', type: 'Number' },
        { name: 'Currency', type: 'String' },
      ],
    ))
    .mockResolvedValueOnce(buildCostResponse(
      [
        [8, 'USD', 'Foundry Models'],
        [4, 'USD', 'Storage'],
      ],
      [
        { name: 'Cost', type: 'Number' },
        { name: 'Currency', type: 'String' },
        { name: 'ServiceName', type: 'String' },
      ],
    ))
    .mockResolvedValueOnce(buildCostResponse(
      [
        [5, 20260301, 'USD'],
        [7, 20260302, 'USD'],
      ],
      [
        { name: 'Cost', type: 'Number' },
        { name: 'UsageDate', type: 'Number' },
        { name: 'Currency', type: 'String' },
      ],
    ));
}

describe('azureCostManagement caching/backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T14:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('reuses a fresh cached cost summary instead of issuing another four Cost Management requests', async () => {
    const fetchMock = buildSuccessFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const { getAzureResourceGroupCostSummary } = await loadModule();

    const first = await getAzureResourceGroupCostSummary();
    const second = await getAzureResourceGroupCostSummary();

    expect(first.status).toBe('success');
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(harness.getBearerToken).toHaveBeenCalledTimes(4);
  });

  it('serves cached data and enters backoff when a refresh attempt gets Cost Management 429s', async () => {
    const firstFetchMock = buildSuccessFetchMock();
    vi.stubGlobal('fetch', firstFetchMock);
    const { getAzureResourceGroupCostSummary, resetAzureCostManagementCacheForTests } = await loadModule();

    const cached = await getAzureResourceGroupCostSummary();
    expect(cached.status).toBe('success');
    expect(firstFetchMock).toHaveBeenCalledTimes(4);

    vi.setSystemTime(new Date('2026-04-05T14:06:00Z'));

    const throttledFetchMock = vi.fn().mockResolvedValue(new Response('throttled', {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        'retry-after': '120',
      },
    }));
    vi.stubGlobal('fetch', throttledFetchMock);

    const throttledResult = await getAzureResourceGroupCostSummary();
    expect(throttledResult).toEqual(cached);
    expect(throttledFetchMock).toHaveBeenCalledTimes(4);

    const backoffResult = await getAzureResourceGroupCostSummary();
    expect(backoffResult).toEqual(cached);
    expect(throttledFetchMock).toHaveBeenCalledTimes(4);

    resetAzureCostManagementCacheForTests();
  });
});