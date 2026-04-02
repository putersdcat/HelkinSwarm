import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

describe('skill operational state assessment', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
  });

  it('distinguishes operational, action-required, and operator-setup-required skills', { timeout: 15000 }, async () => {
    const {
      loadCapabilities,
      getSkillCatalog,
      inspectSkillInstall,
    } = await import('../../src/capabilities/capabilityLoader.js');
    const { toolRegistry } = await import('../../src/tools/toolRegistry.js');
    toolRegistry.clear();

    await loadCapabilities([join(process.cwd(), 'skills')]);

    const catalog = getSkillCatalog();
    const byDomain = Object.fromEntries(catalog.map((entry) => [entry.domain, entry]));

    expect(byDomain['graphenterprise']?.operationalState).toBe('operator-setup-required');
    expect(byDomain['web']?.operationalState).toBe('operator-setup-required');
    expect(byDomain['outlook']?.operationalState).toBe('action-required');
    expect(byDomain['microsoftlearn']?.operationalState).toBe('operational');

    const graphenterprise = inspectSkillInstall('graphenterprise');
    expect(graphenterprise.status).toBe('operator-setup-required');
    expect(graphenterprise.message).toContain('operator or tenant setup');

    const outlook = inspectSkillInstall('outlook');
    expect(outlook.status).toBe('action-required');
    expect(outlook.steps).toContain('Complete OAuth authorisation via /link (connection: GraphOAuth)');

    const microsoftLearn = inspectSkillInstall('microsoftlearn');
    expect(microsoftLearn.status).toBe('operational');
    expect(microsoftLearn.steps).toEqual(['No setup required — skill is ready to use.']);
  });
});
