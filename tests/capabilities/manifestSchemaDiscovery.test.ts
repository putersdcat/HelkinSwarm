import { describe, expect, it } from 'vitest';
import { CapabilityManifestSchema } from '../../src/capabilities/manifestSchema.js';

describe('CapabilityManifestSchema discovery metadata', () => {
  it('accepts optional skill-level and tool-level discovery fields', () => {
    const parsed = CapabilityManifestSchema.parse({
      domain: 'demo',
      version: '1.0',
      shortName: 'demo',
      displayName: 'Demo',
      shortDescription: 'Demo discovery skill',
      iconUrl: 'https://example.com/demo.png',
      deploymentScenario: 'personal-user-centric',
      onboardingMethod: 'automatic-agentic',
      lifecycleRules: 'keep-credentials',
      discoveryHints: ['demo', 'search'],
      orchestratorUseCases: ['discover demo tools'],
      modelAffinity: {
        discovery: 'fast',
        execution: 'fast',
        synthesis: 'primary',
      },
      recommendedEntryTools: ['demo_search'],
      tools: [
        {
          name: 'demo_search',
          description: 'Search the demo corpus.',
          risk: 'low',
          dataSensitivity: 'non-pii',
          requiresConfirmation: false,
          requiresExecutor: false,
          requiresSubAgent: false,
          privilegeClass: 'read-only',
          aliases: ['search demo'],
          discoveryTerms: ['demo query'],
          useWhen: ['the user asks to search demo data'],
          avoidWhen: ['the user needs to create demo data'],
          typicalInputs: ['search the demo corpus for invoices'],
          returnsSummaryShape: 'array of search results',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ],
    });

    expect(parsed.discoveryHints).toContain('demo');
    expect(parsed.modelAffinity?.synthesis).toBe('primary');
    expect(parsed.tools[0]?.aliases).toContain('search demo');
    expect(parsed.tools[0]?.returnsSummaryShape).toBe('array of search results');
  });

  it('defaults discovery arrays to empty when omitted', () => {
    const parsed = CapabilityManifestSchema.parse({
      domain: 'demo-minimal',
      version: '1.0',
      shortName: 'demo-minimal',
      displayName: 'Demo Minimal',
      shortDescription: 'Minimal demo skill',
      iconUrl: 'https://example.com/demo-minimal.png',
      deploymentScenario: 'personal-user-centric',
      onboardingMethod: 'automatic-agentic',
      lifecycleRules: 'keep-credentials',
      tools: [
        {
          name: 'demo_minimal_lookup',
          description: 'Read-only lookup.',
          risk: 'low',
          dataSensitivity: 'non-pii',
          requiresConfirmation: false,
          requiresExecutor: false,
          requiresSubAgent: false,
          privilegeClass: 'read-only',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ],
    });

    expect(parsed.discoveryHints).toEqual([]);
    expect(parsed.orchestratorUseCases).toEqual([]);
    expect(parsed.recommendedEntryTools).toEqual([]);
    expect(parsed.tools[0]?.aliases).toEqual([]);
    expect(parsed.tools[0]?.discoveryTerms).toEqual([]);
    expect(parsed.tools[0]?.useWhen).toEqual([]);
    expect(parsed.tools[0]?.avoidWhen).toEqual([]);
    expect(parsed.tools[0]?.typicalInputs).toEqual([]);
  });
});