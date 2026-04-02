import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CapabilityManifestSchema } from '../../src/capabilities/manifestSchema.js';

describe('graph enterprise manifest', () => {
  it('declares a read-only streamable-http MCP skill for delegated tenant reporting', () => {
    const manifest = CapabilityManifestSchema.parse(
      JSON.parse(readFileSync('skills/graphenterprise/manifest.json', 'utf8')) as unknown,
    );

    expect(manifest.domain).toBe('graphenterprise');
    expect(manifest.mcpServer?.transport).toBe('streamable-http');
    if (manifest.mcpServer?.transport !== 'streamable-http') {
      throw new Error('Expected streamable-http transport');
    }

    expect(manifest.mcpServer.url).toBe('https://mcp.svc.cloud.microsoft/enterprise');
    expect(manifest.mcpServer.headers).toEqual({
      Authorization: 'Bearer ${scopedToken}',
    });
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'graphenterprise_suggest_queries',
      'graphenterprise_get',
      'graphenterprise_list_properties',
    ]);
    expect(manifest.tools.map((tool) => tool.remoteToolName)).toEqual([
      'microsoft_graph_suggest_queries',
      'microsoft_graph_get',
      'microsoft_graph_list_properties',
    ]);
    expect(manifest.requiredPermissions ?? []).toContain(
      'api://e8c77dc2-69b3-43f4-bc51-3213c9d915b4/MCP.User.Read.All',
    );
    expect(manifest.tools.every((tool) => tool.risk === 'low' && tool.privilegeClass === 'read-only')).toBe(true);
    expect(manifest.tools.every((tool) => tool.requiresSubAgent)).toBe(true);
  });
});
