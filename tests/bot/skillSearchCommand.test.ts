import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
      },
    ],
  },
];

describe('/skillSearch command formatting', () => {
  beforeEach(() => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.cognitiveservices.azure.com';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';
    clearSkillDiscoveryIndex();
    rebuildSkillDiscoveryIndex(manifests);
  });

  it('parses drilldown commands for skill and tool details', async () => {
    const { parseSkillSearchCommand } = await requireSkillSearchCommand();

    expect(parseSkillSearchCommand('/skillSearch skill outlook')).toEqual({
      kind: 'describe_skill',
      skillId: 'outlook',
    });

    expect(parseSkillSearchCommand('/skillSearch tool outlook_search_emails')).toEqual({
      kind: 'describe_tool',
      toolName: 'outlook_search_emails',
    });
  });

  it('renders humane help output and makes the read-only boundary explicit', async () => {
    const { renderSkillSearchCommandResponse } = await requireSkillSearchCommand();
    const response = await renderSkillSearchCommandResponse('/skillSearch');

    expect(response).toContain('read-only skill and tool discovery');
    expect(response).toContain('/skillSearch email calendar');
    expect(response).toContain('never executes tools');
  });

  it('renders ranked search results for chat participants', async () => {
    const { renderSkillSearchCommandResponse } = await requireSkillSearchCommand();
    const response = await renderSkillSearchCommandResponse('/skillSearch mailbox email');

    expect(response).toContain('**Skills**');
    expect(response).toContain('`outlook`');
    expect(response).toContain('`outlook_search_emails`');
    expect(response).toContain('This command stays read-only');
  });

  it('renders tool drilldown output without invoking the tool', async () => {
    const { renderSkillSearchCommandResponse } = await requireSkillSearchCommand();
    const response = await renderSkillSearchCommandResponse('/skillSearch tool outlook_search_emails');

    expect(response).toContain('**Tool:** `outlook_search_emails`');
    expect(response).toContain('requires sub-agent: yes');
    expect(response).toContain('This command is discovery-only and does not invoke the tool');
  });

  it('is wired into the bot slash-command routing before overseer handoff', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("if (lowerMessage.startsWith('/skillsearch')) {");
    expect(source).toContain('await renderSkillSearchCommandResponse(messageText);');
    expect(source).toContain("textFormat: 'markdown'");
  });
});

function requireSkillSearchCommand() {
  return import('../../src/bot/skillSearchCommand.js');
}