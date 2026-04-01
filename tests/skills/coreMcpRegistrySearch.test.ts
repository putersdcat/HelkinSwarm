import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function buildServerResponse(input: {
  name: string;
  title?: string;
  description: string;
  version: string;
  status?: 'active' | 'deprecated' | 'deleted';
}) {
  return {
    server: {
      name: input.name,
      title: input.title,
      description: input.description,
      version: input.version,
      packages: [
        {
          registryType: 'npm',
          identifier: `@example/${input.name.split('/')[1] ?? 'server'}`,
          version: input.version,
          transport: { type: 'stdio' },
        },
      ],
    },
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        status: input.status ?? 'active',
        publishedAt: '2026-03-30T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        isLatest: true,
      },
    },
  };
}

describe('helkin_mcp_registry_search', () => {
  beforeEach(() => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.cognitiveservices.azure.com';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    const { resetMcpRegistryCatalogForTests } = await import('../../src/mcp/mcpRegistryCatalog.js');
    resetMcpRegistryCatalogForTests();
  });

  it('returns usage guidance for help', async () => {
    const { helkin_mcp_registry_search } = await import('../../skills/core/handlers.js');
    const result = await helkin_mcp_registry_search({ command: 'help' }) as { usage: string[] };
    expect(result.usage[1]).toContain('command=search');
  });

  it('searches synced registry candidates without blurring them with installed skills', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      servers: [
        buildServerResponse({
          name: 'io.github.microsoft/azure-mcp',
          title: 'Azure MCP Server',
          description: 'Azure operations and provisioning',
          version: '1.2.0',
        }),
        buildServerResponse({
          name: 'io.github.microsoftdocs/learn-mcp',
          title: 'Microsoft Learn MCP',
          description: 'Official Microsoft docs search',
          version: '0.9.0',
          status: 'deprecated',
        }),
      ],
      metadata: { nextCursor: null, count: 2 },
    }))));

    const { helkin_mcp_registry_search } = await import('../../skills/core/handlers.js');
    const result = await helkin_mcp_registry_search({ command: 'search', query: 'azure operations', limit: 5 }) as {
      candidates: Array<{ name: string; status: string; currentState: string; transportTypes: string[]; activationGate: { aiApprovalEligible: boolean } }>;
      syncStatus: { totalCached: number };
      excluded: { deleted: number; malformed: number };
    };

    expect(result.syncStatus.totalCached).toBe(2);
    expect(result.candidates[0]?.name).toBe('io.github.microsoft/azure-mcp');
    expect(result.candidates[0]?.status).toBe('active');
    expect(result.candidates[0]?.currentState).toBe('discovered');
    expect(result.candidates[0]?.activationGate.aiApprovalEligible).toBe(true);
    expect(result.candidates[0]?.transportTypes).toEqual(['stdio']);
    expect(result.excluded).toEqual({ deleted: 0, malformed: 0 });
  });

  it('returns cache status and supports an explicit refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      servers: [
        buildServerResponse({
          name: 'io.github.example/demo',
          title: 'Demo MCP',
          description: 'Demo registry candidate',
          version: '1.0.0',
        }),
      ],
      metadata: { nextCursor: null, count: 1 },
    })));
    vi.stubGlobal('fetch', fetchMock);

    const { helkin_mcp_registry_search } = await import('../../skills/core/handlers.js');
    const refreshResult = await helkin_mcp_registry_search({ command: 'refresh', forceFull: true }) as {
      catalog: { status: string; totalCached: number; lastSyncMode: string | null };
    };
    expect(refreshResult.catalog.status).toBe('ready');
    expect(refreshResult.catalog.totalCached).toBe(1);
    expect(refreshResult.catalog.lastSyncMode).toBe('full');

    const statusResult = await helkin_mcp_registry_search({ command: 'status' }) as {
      catalog: { status: string; totalCached: number };
    };
    expect(statusResult.catalog.status).toBe('ready');
    expect(statusResult.catalog.totalCached).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
