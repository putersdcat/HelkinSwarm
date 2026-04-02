import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

describe('capabilityLoader custom skill discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
  });

  it('discovers nested skills/custom manifests and registers their tools', { timeout: 15000 }, async () => {
    const { loadCapabilities, getHandler, getManifest } = await import('../../src/capabilities/capabilityLoader.js');
    const { toolRegistry } = await import('../../src/tools/toolRegistry.js');
    toolRegistry.clear();

    const result = await loadCapabilities([join(process.cwd(), 'skills')]);

    expect(result.skillsLoaded).toBeGreaterThanOrEqual(7);
    expect(getManifest('forge-create-a-receipts-parser-skill-v367a')).toBeDefined();
    expect(toolRegistry.get('forge_create_a_receipts_parser_skill_v367a_run')).toBeDefined();

    expect(getManifest('mcpreference')).toBeDefined();
    expect(toolRegistry.get('mcpreference_echo')).toBeDefined();

    expect(getManifest('microsoftlearn')).toBeDefined();
    expect(toolRegistry.get('mslearn_docs_search')).toBeDefined();

    expect(getManifest('graphenterprise')).toBeDefined();
    expect(toolRegistry.get('graphenterprise_get')).toBeDefined();

    const mcpHandler = getHandler('mcpreference_echo');
    expect(mcpHandler).toBeDefined();

    const mcpResult = await mcpHandler?.({ message: 'bridge test' }) as {
      echoed: string;
      echoedLength: number;
      via: string;
    };

    expect(mcpResult).toEqual({
      echoed: 'bridge test',
      echoedLength: 11,
      via: 'reference-mcp',
    });
  });
});