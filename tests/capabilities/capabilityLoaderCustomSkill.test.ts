import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

describe('capabilityLoader custom skill discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
  });

  it('discovers nested skills/custom manifests and registers their tools', async () => {
    const { loadCapabilities, getManifest } = await import('../../src/capabilities/capabilityLoader.js');
    const { toolRegistry } = await import('../../src/tools/toolRegistry.js');
    toolRegistry.clear();

    const result = await loadCapabilities([join(process.cwd(), 'skills')]);

    expect(result.skillsLoaded).toBeGreaterThanOrEqual(7);
    expect(getManifest('forge-create-a-receipts-parser-skill-v367a')).toBeDefined();
    expect(toolRegistry.get('forge_create_a_receipts_parser_skill_v367a_run')).toBeDefined();
  });
});