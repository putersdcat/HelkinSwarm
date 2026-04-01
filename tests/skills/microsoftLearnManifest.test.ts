import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CapabilityManifestSchema } from '../../src/capabilities/manifestSchema.js';

describe('microsoft learn manifest', () => {
  it('declares a low-risk remote streamable-http MCP skill for official Microsoft documentation grounding', () => {
    const manifest = CapabilityManifestSchema.parse(
      JSON.parse(readFileSync('skills/microsoftlearn/manifest.json', 'utf8')) as unknown,
    );

    expect(manifest.domain).toBe('microsoftlearn');
    expect(manifest.mcpServer?.transport).toBe('streamable-http');
    if (manifest.mcpServer?.transport !== 'streamable-http') {
      throw new Error('Expected streamable-http transport');
    }

    expect(manifest.mcpServer.url).toContain('https://learn.microsoft.com/api/mcp');
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'mslearn_docs_search',
      'mslearn_docs_fetch',
      'mslearn_code_sample_search',
    ]);
    expect(manifest.tools.map((tool) => tool.remoteToolName)).toEqual([
      'microsoft_docs_search',
      'microsoft_docs_fetch',
      'microsoft_code_sample_search',
    ]);
    expect(manifest.capabilityGroups.map((group) => group.id)).toEqual(['docs', 'code']);
    expect(manifest.tools.every((tool) => tool.risk === 'low' && tool.privilegeClass === 'read-only')).toBe(true);
  });
});
