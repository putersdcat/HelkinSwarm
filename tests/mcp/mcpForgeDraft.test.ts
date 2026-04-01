import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function buildServerResponse(input: {
  name: string;
  title?: string;
  description: string;
  version: string;
  status?: 'active' | 'deprecated' | 'deleted';
  packages?: Array<{ registryType: string; identifier: string; version?: string; transportType: 'stdio' | 'streamable-http' | 'sse' }>;
  remotes?: Array<{ type: 'streamable-http' | 'sse'; url: string }>;
}) {
  return {
    server: {
      name: input.name,
      title: input.title,
      description: input.description,
      version: input.version,
      packages: (input.packages ?? []).map((pkg) => ({
        registryType: pkg.registryType,
        identifier: pkg.identifier,
        version: pkg.version,
        transport: { type: pkg.transportType },
      })),
      remotes: input.remotes,
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

const evaluation = {
  decision: 'draft' as const,
  displayName: 'Azure MCP Draft',
  shortDescription: 'Drafted Azure MCP onboarding wrapper',
  deploymentScenario: 'enterprise-commercial' as const,
  onboardingMethod: 'post-install-link' as const,
  lifecycleRules: 'ask-user' as const,
  discoveryHints: ['azure mcp', 'azure operations'],
  orchestratorUseCases: ['inspect Azure operational state'],
  dependencies: [],
  requiredPermissions: ['Azure RBAC reader'],
  externalAccountsNeeded: ['Azure subscription'],
  risk: 'medium' as const,
  dataSensitivity: 'mixed' as const,
  privilegeClass: 'read-only' as const,
  evaluationSummary: 'Promising candidate with review-required activation path.',
  fitSummary: 'Fits Azure operations research and admin workflows.',
  installAssumptions: ['Assumes npm package is launchable through npx.'],
  transportAssumptions: ['Assumes stdio npm transport remains the supported activation path.'],
  uncertainties: ['Remote tool inventory has not been captured yet.'],
  recommendedNextSteps: ['Capture actual MCP tool inventory before activation PR.'],
  rejectionReason: null,
};

describe('mcpForgeDraft', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    const { resetMcpRegistryCatalogForTests } = await import('../../src/mcp/mcpRegistryCatalog.js');
    resetMcpRegistryCatalogForTests();
  });

  it('builds a persisted review bundle with a draft manifest for a draftable stdio npm candidate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      servers: [
        buildServerResponse({
          name: 'com.microsoft/azure',
          title: 'Azure MCP Server',
          description: 'Azure operations and provisioning',
          version: '2.0.0-beta.36',
          packages: [{ registryType: 'npm', identifier: '@azure/mcp', version: '2.0.0-beta.36', transportType: 'stdio' }],
        }),
      ],
      metadata: { nextCursor: null, count: 1 },
    }))));

    const { buildMcpForgeDraftBundle } = await import('../../src/mcp/mcpForgeDraft.js');
    const result = await buildMcpForgeDraftBundle(
      {
        candidateName: 'com.microsoft/azure',
        userId: 'owner-user',
        correlationId: 'corr-451',
        useCase: 'Azure admin discovery for HelkinSwarm virtual workers',
      },
      {
        evaluateCandidate: async () => evaluation,
        persistBundle: async () => 'bundles/owner-user/mcp-com-microsoft-azure/corr-451.json',
      },
    );

    expect(result.status).toBe('drafted');
    expect(result.persistedBundlePath).toBe('bundles/owner-user/mcp-com-microsoft-azure/corr-451.json');
    expect(result.files.map((file) => file.path)).toEqual([
      'drafts/mcpforge/mcp-com-microsoft-azure/manifest.draft.json',
      'drafts/mcpforge/mcp-com-microsoft-azure/review.md',
    ]);

    const manifestFile = result.files.find((file) => file.path.endsWith('manifest.draft.json'));
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(manifestFile!.content) as { mcpServer: { command: string; args: string[] }; tools: Array<{ name: string; requiresConfirmation: boolean }> };
    expect(manifest.mcpServer.command).toBe('npx');
    expect(manifest.mcpServer.args).toEqual(['-y', '@azure/mcp@2.0.0-beta.36']);
    expect(manifest.tools[0]?.name).toContain('pending_inventory_capture');
    expect(manifest.tools[0]?.requiresConfirmation).toBe(true);
    expect(result.summary).toContain('review-only');
  });

  it('rejects a candidate that cannot be normalized into the current stdio-only runtime draft shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      servers: [
        buildServerResponse({
          name: 'io.github.example/remote-only-server',
          title: 'Remote Only Server',
          description: 'Requires remote streamable-http transport',
          version: '1.0.0',
          remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
        }),
      ],
      metadata: { nextCursor: null, count: 1 },
    }))));

    const { buildMcpForgeDraftBundle } = await import('../../src/mcp/mcpForgeDraft.js');
    const result = await buildMcpForgeDraftBundle(
      {
        candidateName: 'io.github.example/remote-only-server',
        userId: 'owner-user',
        correlationId: 'corr-remote',
      },
      {
        evaluateCandidate: async () => ({
          ...evaluation,
          displayName: 'Remote Only Server',
        }),
        persistBundle: async () => 'bundles/owner-user/mcp-io-github-example-remote-only-server/corr-remote.json',
      },
    );

    expect(result.status).toBe('rejected');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe('drafts/mcpforge/mcp-io-github-example-remote-only-server/review.md');
    expect(result.recommendedNextSteps.join(' ')).toContain('runtime launch instructions');
    expect(result.uncertainties.join(' ')).toContain('stdio');
  });
});
