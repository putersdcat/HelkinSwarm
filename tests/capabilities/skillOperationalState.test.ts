import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { assessSkillOperationalState } from '../../src/capabilities/skillOperationalState.js';
import type { CapabilityManifest } from '../../src/capabilities/manifestSchema.js';

function makeManifest(overrides: Partial<CapabilityManifest> = {}): CapabilityManifest {
  return {
    domain: 'test',
    version: '1.0',
    shortName: 'test',
    displayName: 'Test Skill',
    shortDescription: 'A test skill',
    deploymentScenario: 'personal-user-centric',
    onboardingMethod: 'automatic-agentic',
    lifecycleRules: 'keep-credentials',
    dependencies: [],
    capabilityGroups: [],
    ...overrides,
  } as CapabilityManifest;
}

describe('assessSkillOperationalState — unit', () => {
  const installed = new Set(['core', 'web']);

  it('returns operational for a simple skill with no requirements', () => {
    const result = assessSkillOperationalState(makeManifest(), installed);
    expect(result.operationalState).toBe('operational');
  });

  it('returns operator-setup-required for operator/backend-config-required (#641)', () => {
    const result = assessSkillOperationalState(
      makeManifest({ onboardingMethod: 'operator/backend-config-required' }),
      installed,
    );
    expect(result.operationalState).toBe('operator-setup-required');
  });

  it('returns action-required for post-install-link skills', () => {
    const result = assessSkillOperationalState(
      makeManifest({ onboardingMethod: 'post-install-link' }),
      installed,
    );
    expect(result.operationalState).toBe('action-required');
  });

  it('treats satisfiedBy:oauth-link accounts as non-blocking (#649)', () => {
    const result = assessSkillOperationalState(
      makeManifest({
        onboardingMethod: 'automatic-agentic',
        externalAccountsNeeded: [
          { description: 'Entra work account', satisfiedBy: 'oauth-link' },
        ],
      }),
      installed,
    );
    expect(result.operationalState).toBe('operational');
  });

  it('treats required:false external accounts as optional — skill stays operational', () => {
    const result = assessSkillOperationalState(
      makeManifest({
        onboardingMethod: 'automatic-agentic',
        externalAccountsNeeded: [
          { description: 'Optional key', envVarName: 'MISSING_KEY_OPTIONAL_TEST', required: false },
        ],
      }),
      installed,
    );
    expect(result.operationalState).toBe('operational');
  });

  it('returns blocked when dependencies are missing', () => {
    const result = assessSkillOperationalState(
      makeManifest({ dependencies: ['outlook'] }),
      installed,
    );
    expect(result.operationalState).toBe('blocked');
    expect(result.missingDependencies).toEqual(['outlook']);
  });
});

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
    expect(byDomain['web']?.operationalState).toBe('operational'); // Brave key is optional — DuckDuckGo fallback makes it operational
    expect(byDomain['outlook']?.operationalState).toBe('action-required');
    expect(byDomain['microsoftlearn']?.operationalState).toBe('operational');
    expect(byDomain['x']?.operationalState).toBe('operator-setup-required'); // #641 — operator/backend-config-required must not be operational

    const graphenterprise = inspectSkillInstall('graphenterprise');
    expect(graphenterprise.status).toBe('operator-setup-required');
    expect(graphenterprise.message).toContain('operator or tenant setup');

    const outlook = inspectSkillInstall('outlook');
    expect(outlook.status).toBe('action-required');
    expect(outlook.steps).toContain('Complete OAuth authorisation via /link (connection: GraphOAuth)');

    const microsoftLearn = inspectSkillInstall('microsoftlearn');
    expect(microsoftLearn.status).toBe('operational');
    expect(microsoftLearn.steps).toEqual(['No setup required — skill is ready to use.']);

    // #641 — operator/backend-config-required must surface as operator-setup-required
    const xSkill = inspectSkillInstall('x');
    expect(xSkill.status).toBe('operator-setup-required');
    expect(xSkill.message).toContain('operator or tenant setup');
  });
});
