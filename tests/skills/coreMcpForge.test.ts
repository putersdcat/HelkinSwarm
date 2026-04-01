import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/mcp/mcpForgeDraft.js', () => ({
  buildMcpForgeDraftBundle: vi.fn(async () => ({
    status: 'drafted',
    candidateName: 'com.microsoft/azure',
    draftSkillId: 'mcp-com-microsoft-azure',
    displayName: 'Azure MCP Draft',
    summary: 'drafted',
    persistedBundlePath: 'bundles/demo.json',
    reviewTitle: 'McpForge draft: Azure MCP Draft',
    reviewBody: 'review body',
    evaluationSummary: 'evaluation summary',
    uncertainties: ['inventory not captured'],
    recommendedNextSteps: ['capture tool inventory'],
    files: [],
  })),
  inspectMcpForgeBundle: vi.fn(async (bundlePath: string) => ({
    bundleKind: 'mcpforge',
    candidateName: 'com.microsoft/azure',
    draftSkillId: 'mcp-com-microsoft-azure',
    displayName: 'Azure MCP Draft',
    status: 'drafted',
    reviewTitle: 'title',
    reviewBody: 'body',
    evaluationSummary: 'summary',
    uncertainties: ['inventory not captured'],
    recommendedNextSteps: ['capture tool inventory'],
    candidateSnapshot: {
      name: 'com.microsoft/azure',
      title: 'Azure MCP',
      description: 'Azure operations',
      latestVersion: '2.0.0-beta.36',
      status: 'active',
      statusMessage: null,
      repositoryUrl: null,
      websiteUrl: null,
      transportTypes: ['stdio'],
    },
    files: [{ path: 'drafts/demo/review.md', content: '...', purpose: 'review' }],
    requestedPath: bundlePath,
  })),
}));

describe('helkin_mcp_forge', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.cognitiveservices.azure.com';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';
  });

  it('returns help guidance', async () => {
    const { helkin_mcp_forge } = await import('../../skills/core/handlers.js');
    const result = await helkin_mcp_forge({ command: 'help' }) as { usage: string[] };
    expect(result.usage[1]).toContain('draft_candidate');
  });

  it('drafts a candidate bundle through the McpForge module', async () => {
    const { helkin_mcp_forge } = await import('../../skills/core/handlers.js');
    const result = await helkin_mcp_forge({ command: 'draft_candidate', candidateName: 'com.microsoft/azure', userId: 'owner-user', correlationId: 'corr-1' }) as {
      status: string;
      candidateName: string;
      persistedBundlePath: string | null;
    };

    expect(result.status).toBe('drafted');
    expect(result.candidateName).toBe('com.microsoft/azure');
    expect(result.persistedBundlePath).toBe('bundles/demo.json');
  });

  it('loads a persisted draft bundle for inspection', async () => {
    const { helkin_mcp_forge } = await import('../../skills/core/handlers.js');
    const result = await helkin_mcp_forge({ command: 'inspect_bundle', bundlePath: 'bundles/demo.json' }) as {
      status: string;
      bundle: { bundleKind: string; draftSkillId: string };
    };

    expect(result.status).toBe('success');
    expect(result.bundle.bundleKind).toBe('mcpforge');
    expect(result.bundle.draftSkillId).toBe('mcp-com-microsoft-azure');
  });
});
