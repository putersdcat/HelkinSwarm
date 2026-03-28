import { beforeEach, describe, expect, it } from 'vitest';
import { clearSkillDiscoveryIndex, rebuildSkillDiscoveryIndex } from '../../src/capabilities/skillDiscoveryIndex.js';
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
    discoveryHints: ['email', 'calendar'],
    orchestratorUseCases: ['read email and inspect meetings'],
    recommendedEntryTools: ['outlook_search_emails'],
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
        discoveryTerms: ['mail search'],
        useWhen: ['you need to find candidate emails'],
        avoidWhen: ['you already have a message id'],
        typicalInputs: ['find emails from GitHub'],
        returnsSummaryShape: 'array of matching email summaries',
      },
    ],
  },
];

describe('helkin_skill_search', () => {
  beforeEach(() => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.cognitiveservices.azure.com';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';
    clearSkillDiscoveryIndex();
    rebuildSkillDiscoveryIndex(manifests);
  });

  it('returns usage guidance for help', async () => {
    const { helkin_skill_search } = await import('../../skills/core/handlers.js');
    const result = await helkin_skill_search({ command: 'help' }) as { usage: string[] };
    expect(result.usage[0]).toContain('command=help');
  });

  it('returns ranked skill and tool matches for search', async () => {
    const { helkin_skill_search } = await import('../../skills/core/handlers.js');
    const result = await helkin_skill_search({ command: 'search', query: 'search mailbox emails' }) as {
      skills: Array<{ domain: string }>;
      tools: Array<{ name: string }>;
    };

    expect(result.skills[0]?.domain).toBe('outlook');
    expect(result.tools[0]?.name).toBe('outlook_search_emails');
  });

  it('describes a specific tool', async () => {
    const { helkin_skill_search } = await import('../../skills/core/handlers.js');
    const result = await helkin_skill_search({ command: 'describe_tool', toolName: 'outlook_search_emails' }) as {
      toolName: string;
      safetyCompatible: boolean;
      requiresSubAgent: boolean;
    };

    expect(result.toolName).toBe('outlook_search_emails');
    expect(result.requiresSubAgent).toBe(true);
    expect(result.safetyCompatible).toBe(true);
  });
});