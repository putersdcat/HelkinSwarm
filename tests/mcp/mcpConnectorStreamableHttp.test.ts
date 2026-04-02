import { beforeEach, describe, expect, it, vi } from 'vitest';

const transportHarness = vi.hoisted(() => ({
  instances: [] as Array<{ url: string; options?: RequestInit }>,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    constructor(url: URL, opts?: { requestInit?: RequestInit }) {
      transportHarness.instances.push({ url: url.toString(), options: opts?.requestInit });
    }

    async close(): Promise<void> {
      return undefined;
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioClientTransport {
    stderr = { on: () => undefined };
    constructor(_params: unknown) {}
    async close(): Promise<void> {
      return undefined;
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    constructor(_info: unknown, _opts: unknown) {}
    async connect(_transport: unknown): Promise<void> {
      return undefined;
    }
    async listTools(): Promise<{ tools: Array<{ name: string; description: string }> }> {
      return {
        tools: [
          { name: 'microsoft_docs_search', description: 'Search docs' },
          { name: 'microsoft_docs_fetch', description: 'Fetch docs' },
          { name: 'microsoft_graph_get', description: 'Run read-only Graph GET' },
        ],
      };
    }
    async callTool(): Promise<never> {
      return {
        isError: false,
        structuredContent: {
          ok: true,
        },
      } as never;
    }
  },
}));

describe('mcpConnector streamable-http support', () => {
  beforeEach(() => {
    vi.resetModules();
    transportHarness.instances.length = 0;
  });

  it('smoke-tests a streamable-http MCP manifest without using stdio launch parameters', async () => {
    const { smokeTestMcpServerForManifest } = await import('../../src/mcp/mcpConnector.js');

    const result = await smokeTestMcpServerForManifest({
      domain: 'microsoftlearn',
      version: '1.0',
      shortName: 'mslearn',
      displayName: 'Microsoft Learn MCP',
      shortDescription: 'Official Microsoft docs grounding',
      iconUrl: 'https://example.com/icon.png',
      deploymentScenario: 'enterprise-commercial',
      onboardingMethod: 'automatic-agentic',
      lifecycleRules: 'keep-credentials',
      dependencies: [],
      requiredPermissions: [],
      externalAccountsNeeded: [],
      capabilityGroups: [],
      discoveryHints: [],
      orchestratorUseCases: [],
      recommendedEntryTools: ['mslearn_docs_search'],
      mcpServer: {
        transport: 'streamable-http',
        url: 'https://learn.microsoft.com/api/mcp?maxTokenBudget=2000',
        headers: { 'X-Test': '1' },
        timeoutMs: 30000,
      },
      tools: [
        {
          name: 'mslearn_docs_search',
          remoteToolName: 'microsoft_docs_search',
          description: 'Search docs',
          risk: 'low',
          dataSensitivity: 'non-pii',
          allowedModelLane: 'any',
          requiresConfirmation: false,
          requiresExecutor: false,
          requiresSubAgent: false,
          privilegeClass: 'read-only',
          externalAutomationCapabilities: [],
          longTermMemorySchema: [],
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ],
    });

    expect(transportHarness.instances).toEqual([
      {
        url: 'https://learn.microsoft.com/api/mcp?maxTokenBudget=2000',
        options: { headers: { 'X-Test': '1' } },
      },
    ]);
    expect(result.passed).toBe(true);
    expect(result.toolCount).toBe(3);
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'microsoft_docs_search',
      'microsoft_docs_fetch',
      'microsoft_graph_get',
    ]);
  });

  it('injects per-call bearer headers for streamable-http MCP handlers when the manifest uses scopedToken templates', async () => {
    const { registerMcpHandlersForManifest } = await import('../../src/mcp/mcpConnector.js');

    let handler: ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
    await registerMcpHandlersForManifest({
      relativeSkillDir: 'graphenterprise',
      manifest: {
        domain: 'graphenterprise',
        version: '1.0',
        shortName: 'graph-enterprise',
        displayName: 'Microsoft Graph Enterprise MCP',
        shortDescription: 'Enterprise reporting',
        iconUrl: 'https://example.com/icon.png',
        deploymentScenario: 'enterprise-commercial',
        onboardingMethod: 'automatic-agentic',
        lifecycleRules: 'keep-credentials',
        dependencies: [],
        requiredPermissions: [],
        externalAccountsNeeded: [],
        capabilityGroups: [],
        discoveryHints: [],
        orchestratorUseCases: [],
        recommendedEntryTools: ['graphenterprise_get'],
        mcpServer: {
          transport: 'streamable-http',
          url: 'https://mcp.svc.cloud.microsoft/enterprise',
          headers: {
            Authorization: 'Bearer ${scopedToken}',
            'X-Correlation-Id': '${correlationId}',
          },
          timeoutMs: 30000,
        },
        tools: [
          {
            name: 'graphenterprise_get',
            remoteToolName: 'microsoft_graph_get',
            description: 'Execute read-only Graph GET',
            risk: 'low',
            dataSensitivity: 'pii',
            allowedModelLane: 'global',
            requiresConfirmation: false,
            requiresExecutor: false,
            requiresSubAgent: true,
            privilegeClass: 'read-only',
            externalAutomationCapabilities: [],
            longTermMemorySchema: [],
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
        ],
      },
      registerHandler: (toolName, registeredHandler) => {
        if (toolName === 'graphenterprise_get') {
          handler = registeredHandler;
        }
      },
    });

    const result = await handler?.({
      uri: 'GET /users/$count',
      userId: 'user-1',
      correlationId: 'corr-1',
      _scopedToken: 'delegated-enterprise-token',
    });

    expect(result).toEqual({ ok: true });
    expect(transportHarness.instances).toContainEqual({
      url: 'https://mcp.svc.cloud.microsoft/enterprise',
      options: {
        headers: {
          Authorization: 'Bearer delegated-enterprise-token',
          'X-Correlation-Id': 'corr-1',
        },
      },
    });
  });
});
