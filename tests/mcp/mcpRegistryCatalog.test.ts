import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function buildServerResponse(input: {
  name: string;
  title?: string;
  description: string;
  version: string;
  status?: 'active' | 'deprecated' | 'deleted';
  statusMessage?: string;
  updatedAt?: string;
  packages?: Array<{
    registryType: string;
    identifier: string;
    version?: string;
    transportType: 'stdio' | 'streamable-http' | 'sse';
  }>;
  websiteUrl?: string;
  repositoryUrl?: string;
}) {
  return {
    server: {
      name: input.name,
      title: input.title,
      description: input.description,
      version: input.version,
      websiteUrl: input.websiteUrl,
      repository: input.repositoryUrl ? { url: input.repositoryUrl, source: 'github' } : undefined,
      packages: (input.packages ?? []).map((pkg) => ({
        registryType: pkg.registryType,
        identifier: pkg.identifier,
        version: pkg.version,
        transport: { type: pkg.transportType },
      })),
    },
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        status: input.status ?? 'active',
        statusMessage: input.statusMessage,
        publishedAt: '2026-03-30T00:00:00.000Z',
        updatedAt: input.updatedAt ?? '2026-04-01T00:00:00.000Z',
        isLatest: true,
      },
    },
  };
}

describe('mcpRegistryCatalog', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.cognitiveservices.azure.com';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    const { resetMcpRegistryCatalogForTests } = await import('../../src/mcp/mcpRegistryCatalog.js');
    resetMcpRegistryCatalogForTests();
  });

  it('syncs paginated latest-version registry data into a local cache and searches it locally', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        servers: [
          buildServerResponse({
            name: 'io.github.microsoft/azure-mcp',
            title: 'Azure MCP Server',
            description: 'Azure operations and provisioning',
            version: '1.2.0',
            packages: [{ registryType: 'npm', identifier: '@microsoft/azure-mcp', version: '1.2.0', transportType: 'stdio' }],
            repositoryUrl: 'https://github.com/microsoft/mcp',
          }),
        ],
        metadata: { nextCursor: 'cursor-2', count: 1 },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        servers: [
          buildServerResponse({
            name: 'io.github.microsoftdocs/learn-mcp',
            title: 'Microsoft Learn MCP',
            description: 'Official docs search and fetch',
            version: '0.9.0',
            status: 'deprecated',
            statusMessage: 'Superseded soon',
            packages: [{ registryType: 'npm', identifier: '@microsoftdocs/learn-mcp', version: '0.9.0', transportType: 'stdio' }],
          }),
        ],
        metadata: { nextCursor: null, count: 1 },
      })));
    vi.stubGlobal('fetch', fetchMock);

    const { ensureFreshMcpRegistryCatalog, getMcpRegistryCatalogStatus, searchMcpRegistryCatalog } = await import('../../src/mcp/mcpRegistryCatalog.js');

    const syncStatus = await ensureFreshMcpRegistryCatalog();
    expect(syncStatus.status).toBe('ready');
    expect(syncStatus.lastSyncMode).toBe('full');
    expect(syncStatus.totalCached).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const search = await searchMcpRegistryCatalog('azure operations');
    expect(search.candidates[0]?.name).toBe('io.github.microsoft/azure-mcp');
    expect(search.candidates[0]?.transportTypes).toEqual(['stdio']);
    expect(search.syncStatus.deprecated).toBe(1);

    const deprecatedSearch = await searchMcpRegistryCatalog('official docs search', { includeDeprecated: true });
    expect(deprecatedSearch.candidates[0]?.name).toBe('io.github.microsoftdocs/learn-mcp');
    expect(deprecatedSearch.candidates[0]?.currentState).toBe('review-required');
    expect(deprecatedSearch.candidates[0]?.activationGate.aiApprovalEligible).toBe(false);

    const status = getMcpRegistryCatalogStatus();
    expect(status.searchable).toBe(2);
  });

  it('drops malformed candidates, preserves deleted entries in cache state, and excludes them by default from search', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        servers: [
          buildServerResponse({
            name: 'io.github.example/deleted-server',
            title: 'Deleted Server',
            description: 'Should stay visible in status only',
            version: '1.0.0',
            status: 'deleted',
            packages: [{ registryType: 'npm', identifier: '@example/deleted-server', version: '1.0.0', transportType: 'stdio' }],
          }),
          {
            server: {
              name: 'io.github.example/broken-server',
              description: 'Missing transport details',
              version: '1.0.0',
              packages: [{ registryType: 'npm', identifier: '@example/broken-server' }],
            },
          },
        ],
        metadata: { nextCursor: null, count: 2 },
      })));
    vi.stubGlobal('fetch', fetchMock);

    const { ensureFreshMcpRegistryCatalog, searchMcpRegistryCatalog } = await import('../../src/mcp/mcpRegistryCatalog.js');

    const syncStatus = await ensureFreshMcpRegistryCatalog();
    expect(syncStatus.deleted).toBe(1);
    expect(syncStatus.malformedDropped).toBe(1);

    const hiddenDeleted = await searchMcpRegistryCatalog('deleted server');
    expect(hiddenDeleted.candidates).toEqual([]);
    expect(hiddenDeleted.excluded.deleted).toBe(1);
    expect(hiddenDeleted.excluded.malformed).toBe(1);

    const includedDeleted = await searchMcpRegistryCatalog('deleted server', { includeDeleted: true });
    expect(includedDeleted.candidates[0]?.status).toBe('deleted');
  });
});
