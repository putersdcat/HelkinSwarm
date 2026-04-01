import { describe, expect, it, beforeEach } from 'vitest';
import { clearSkillDiscoveryIndex, getSkillDiscoveryIndex, rebuildSkillDiscoveryIndex, searchSkillDiscoveryIndex } from '../../src/capabilities/skillDiscoveryIndex.js';
import type { CapabilityManifest } from '../../src/capabilities/manifestSchema.js';

const manifests: CapabilityManifest[] = [
  {
    domain: 'outlook',
    version: '1.0',
    shortName: 'outlook',
    displayName: 'Outlook',
    shortDescription: 'Email and calendar management',
    iconUrl: 'https://example.com/outlook.png',
    deploymentScenario: 'personal-user-centric',
    onboardingMethod: 'post-install-link',
    lifecycleRules: 'keep-credentials',
    capabilityGroups: [
      {
        id: 'mail-read',
        displayName: 'Mail Read Operations',
        shortDescription: 'Read mailbox content',
        discoveryHints: ['mailbox', 'attachments'],
        useWhen: ['you need to inspect mail'],
        upstreamNamespace: 'mail.read',
        upstreamToolSelectors: ['search'],
      },
    ],
    discoveryHints: ['email', 'calendar', 'mailbox'],
    orchestratorUseCases: ['find emails and inspect meetings'],
    recommendedEntryTools: ['outlook_search_emails'],
    modelAffinity: { discovery: 'fast', execution: 'fast', synthesis: 'primary' },
    tools: [
      {
        name: 'outlook_search_emails',
        description: 'Search mailbox for messages.',
        risk: 'low',
        dataSensitivity: 'pii',
        allowedModelLane: 'any',
        requiresConfirmation: false,
        requiresExecutor: false,
        requiresSubAgent: true,
        privilegeClass: 'read-only',
        aliases: ['search mail'],
        discoveryTerms: ['mail search', 'inbox lookup'],
        useWhen: ['you need to find candidate messages before reading one'],
        avoidWhen: ['you already have a message id'],
        typicalInputs: ['find emails from GitHub'],
        returnsSummaryShape: 'array of matching email summaries',
        capabilityGroup: 'mail-read',
      },
    ],
  },
  {
    domain: 'weather',
    version: '1.0',
    shortName: 'weather',
    displayName: 'Weather',
    shortDescription: 'Forecasts and current weather',
    iconUrl: 'https://example.com/weather.png',
    deploymentScenario: 'personal-user-centric',
    onboardingMethod: 'automatic-agentic',
    lifecycleRules: 'keep-credentials',
    discoveryHints: ['forecast', 'temperature'],
    orchestratorUseCases: ['check weather for travel or planning'],
    recommendedEntryTools: ['weather_get'],
    tools: [
      {
        name: 'weather_get',
        description: 'Get weather by location.',
        risk: 'low',
        dataSensitivity: 'non-pii',
        allowedModelLane: 'any',
        requiresConfirmation: false,
        requiresExecutor: false,
        requiresSubAgent: false,
        privilegeClass: 'read-only',
        aliases: ['get forecast'],
        discoveryTerms: ['weather lookup'],
        useWhen: ['the user asks about weather'],
        avoidWhen: ['the user needs email or calendar data'],
        typicalInputs: ['weather in Amsterdam'],
        returnsSummaryShape: 'weather summary object',
      },
    ],
  },
];

describe('skillDiscoveryIndex', () => {
  beforeEach(() => {
    clearSkillDiscoveryIndex();
  });

  it('rebuilds a compact manifest-derived index', () => {
    const index = rebuildSkillDiscoveryIndex(manifests);

    expect(index.skills).toHaveLength(2);
    expect(index.capabilityGroups).toHaveLength(1);
    expect(index.tools).toHaveLength(2);
    expect(index.skills[0]?.toolCount).toBeGreaterThan(0);
  });

  it('searches both skill-level and tool-level metadata', () => {
    rebuildSkillDiscoveryIndex(manifests);

    const result = searchSkillDiscoveryIndex('search mailbox emails');

    expect(result.skills[0]?.id).toBe('outlook');
    expect(result.capabilityGroups[0]?.id).toBe('outlook/mail-read');
    expect(result.tools[0]?.id).toBe('outlook_search_emails');
    expect(result.tools[0]?.matchReasons).toContain('discovery-terms');
  });

  it('rebuild invalidates stale entries on hot reload', () => {
    rebuildSkillDiscoveryIndex(manifests);
    rebuildSkillDiscoveryIndex([manifests[1]!]);

    const index = getSkillDiscoveryIndex();
    expect(index.skills.map((skill) => skill.domain)).toEqual(['weather']);
    expect(index.capabilityGroups).toEqual([]);
    expect(index.tools.map((tool) => tool.name)).toEqual(['weather_get']);
  });
});