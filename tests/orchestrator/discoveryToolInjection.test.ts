import { beforeEach, describe, expect, it } from 'vitest';
import { clearSkillDiscoveryIndex, rebuildSkillDiscoveryIndex } from '../../src/capabilities/skillDiscoveryIndex.js';
import type { CapabilityManifest } from '../../src/capabilities/manifestSchema.js';

const discoveryManifests: CapabilityManifest[] = [
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
    modelAffinity: { execution: 'reasoning' },
    tools: [
      {
        name: 'outlook_search_emails',
        description: 'search email',
        risk: 'low',
        dataSensitivity: 'pii',
        allowedModelLane: 'any',
        requiresConfirmation: false,
        requiresExecutor: false,
        requiresSubAgent: true,
        privilegeClass: 'read-only',
        aliases: [],
        discoveryTerms: [],
        useWhen: [],
        avoidWhen: [],
        typicalInputs: [],
      },
      {
        name: 'outlook_create_calendar_event',
        description: 'create calendar event',
        risk: 'high',
        dataSensitivity: 'pii',
        allowedModelLane: 'any',
        requiresConfirmation: true,
        requiresExecutor: false,
        requiresSubAgent: true,
        privilegeClass: 'create',
        aliases: [],
        discoveryTerms: [],
        useWhen: [],
        avoidWhen: [],
        typicalInputs: [],
      },
    ],
  },
  {
    domain: 'weather',
    version: '1.0',
    shortName: 'weather',
    displayName: 'Weather',
    shortDescription: 'Weather checks',
    iconUrl: 'https://example.com/weather.png',
    deploymentScenario: 'personal-user-centric',
    onboardingMethod: 'automatic-agentic',
    lifecycleRules: 'keep-credentials',
    discoveryHints: ['forecast'],
    orchestratorUseCases: ['check weather'],
    recommendedEntryTools: ['weather_get'],
    modelAffinity: { execution: 'fast' },
    tools: [
      {
        name: 'weather_get',
        description: 'get weather',
        risk: 'low',
        dataSensitivity: 'non-pii',
        allowedModelLane: 'any',
        requiresConfirmation: false,
        requiresExecutor: false,
        requiresSubAgent: false,
        privilegeClass: 'read-only',
        aliases: [],
        discoveryTerms: [],
        useWhen: [],
        avoidWhen: [],
        typicalInputs: [],
      },
    ],
  },
];

async function seedRegistry(): Promise<void> {
  process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.cognitiveservices.azure.com';
  process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

  clearSkillDiscoveryIndex();
  rebuildSkillDiscoveryIndex(discoveryManifests);

  const { toolRegistry } = await import('../../src/tools/toolRegistry.js');
  toolRegistry.clear();
  toolRegistry.register({
    name: 'helkin_skill_search',
    description: 'discover tools',
    risk: 'low',
    dataSensitivity: 'non-pii',
    requiresConfirmation: false,
    requiresExecutor: false,
    requiresSubAgent: false,
    privilegeClass: 'read-only',
    inputSchema: { type: 'object', properties: {}, required: [] },
  });
  toolRegistry.register({
    name: 'helkin_health_check',
    description: 'health',
    risk: 'low',
    dataSensitivity: 'non-pii',
    requiresConfirmation: false,
    requiresExecutor: false,
    requiresSubAgent: false,
    privilegeClass: 'read-only',
    inputSchema: { type: 'object', properties: {}, required: [] },
  });
  toolRegistry.register({
    name: 'outlook_search_emails',
    description: 'search email',
    risk: 'low',
    dataSensitivity: 'pii',
    requiresConfirmation: false,
    requiresExecutor: false,
    requiresSubAgent: true,
    privilegeClass: 'read-only',
    inputSchema: { type: 'object', properties: {}, required: [] },
  });
  toolRegistry.register({
    name: 'outlook_create_calendar_event',
    description: 'create calendar event',
    risk: 'high',
    dataSensitivity: 'pii',
    requiresConfirmation: true,
    requiresExecutor: false,
    requiresSubAgent: true,
    privilegeClass: 'create',
    inputSchema: { type: 'object', properties: {}, required: [] },
  });
}

describe('discoveryToolInjection', () => {
  beforeEach(async () => {
    await seedRegistry();
  });

  it('keeps the initial discovery-first tool surface core-only', async () => {
    const { getDiscoveryFirstToolSchemas } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const initial = getDiscoveryFirstToolSchemas();
    expect(initial.map((tool) => tool.function.name)).toEqual([
      'helkin_skill_search',
      'helkin_health_check',
    ]);
  });

  it('narrows second-hop tool schemas from discovery search results', async () => {
    const { deriveSelectiveFollowUpToolSchemas } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const tools = deriveSelectiveFollowUpToolSchemas([
      {
        toolName: 'helkin_skill_search',
        success: true,
        result: {
          tools: [{ name: 'outlook_search_emails' }],
          skills: [],
        },
      },
    ]);

    expect(tools?.map((tool) => tool.function.name)).toEqual([
      'helkin_skill_search',
      'helkin_health_check',
      'outlook_search_emails',
    ]);
  });

  it('forces discovery for external action intents only', async () => {
    const { shouldForceDiscoveryToolSearch } = await import('../../src/orchestrator/discoveryToolInjection.js');

    expect(shouldForceDiscoveryToolSearch('Send an email to Eric')).toBe(true);
    expect(shouldForceDiscoveryToolSearch('Create a calendar event for tomorrow')).toBe(true);
    expect(shouldForceDiscoveryToolSearch('Use the exact tool outlook_list_attachments for this messageId')).toBe(true);
    expect(shouldForceDiscoveryToolSearch('Download the attachment with content ID cid:hero-image from this message')).toBe(true);
    expect(shouldForceDiscoveryToolSearch('hello there')).toBe(false);
  });

  it('detects explicit read-only discovery requests and extracts a focused query', async () => {
    const {
      buildReadOnlyDiscoveryQuery,
      isReadOnlyDiscoveryRequest,
      shouldForceDiscoveryToolSearch,
    } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const prompt = '/light Use discovery only and tell me which tool you would use to search mailbox emails for issue 423 secondary. Do not execute any non-discovery tools.';

    expect(isReadOnlyDiscoveryRequest(prompt)).toBe(true);
    expect(buildReadOnlyDiscoveryQuery(prompt)).toBe('search mailbox emails');
    expect(shouldForceDiscoveryToolSearch(prompt)).toBe(true);
  });

  it('forces the concrete follow-up action tool when discovery surfaced it', async () => {
    const { getForcedDiscoveryFollowUpToolChoice } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const choice = getForcedDiscoveryFollowUpToolChoice('Send an email to Eric', [
      {
        type: 'function',
        function: {
          name: 'outlook_send_email',
          description: 'send email',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ]);

    expect(choice).toEqual({ type: 'function', function: { name: 'outlook_send_email' } });
  });

  it('prefers an explicit tool-name mention over the generic email-send fallback', async () => {
    const { getForcedDiscoveryFollowUpToolChoice } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const choice = getForcedDiscoveryFollowUpToolChoice(
      'Use the exact tool outlook_search_emails with query hasAttachment:true and return the first result.',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_search_emails',
            description: 'search emails',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'outlook_send_email',
            description: 'send email',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(choice).toEqual({ type: 'function', function: { name: 'outlook_search_emails' } });
  });

  it('prefers outlook_search_emails for search intents even when the prompt mentions email generically', async () => {
    const { getForcedDiscoveryFollowUpToolChoice } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const choice = getForcedDiscoveryFollowUpToolChoice(
      'Search my Outlook mailbox for the most recent email that has attachments.',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_search_emails',
            description: 'search emails',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'outlook_send_email',
            description: 'send email',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(choice).toEqual({ type: 'function', function: { name: 'outlook_search_emails' } });
  });

  it('keeps explicit read-only discovery prompts pinned to helkin_skill_search on follow-up', async () => {
    const { getForcedDiscoveryFollowUpToolChoice } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const choice = getForcedDiscoveryFollowUpToolChoice(
      'Use discovery only and tell me which tool you would use to search mailbox emails. Do not execute any non-discovery tools.',
      [
        {
          type: 'function',
          function: {
            name: 'helkin_skill_search',
            description: 'discover tools',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'outlook_send_email',
            description: 'send email',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(choice).toEqual({ type: 'function', function: { name: 'helkin_skill_search' } });
  });

  it('forces calendar creation when discovery surfaced the event-creation tool', async () => {
    const { getForcedDiscoveryFollowUpToolChoice } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const choice = getForcedDiscoveryFollowUpToolChoice(
      'Please put a new meeting in my calendar for lunch tomorrow at 12:30',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_create_calendar_event',
            description: 'create calendar event',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(choice).toEqual({ type: 'function', function: { name: 'outlook_create_calendar_event' } });
  });

  it('includes recommended entry tools from matched skills in the follow-up subset', async () => {
    const { deriveSelectiveFollowUpToolSchemas } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const tools = deriveSelectiveFollowUpToolSchemas([
      {
        toolName: 'helkin_skill_search',
        success: true,
        result: {
          tools: [],
          skills: [{ recommendedEntryTools: ['outlook_create_calendar_event'] }],
        },
      },
    ]);

    expect(tools?.map((tool) => tool.function.name)).toEqual([
      'helkin_skill_search',
      'helkin_health_check',
      'outlook_create_calendar_event',
    ]);
  });

  it('derives a primary follow-up model override when matched skills consistently prefer reasoning/primary execution', async () => {
    const { getDiscoveryFollowUpModelOverride } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const override = getDiscoveryFollowUpModelOverride([
      {
        toolName: 'helkin_skill_search',
        success: true,
        result: {
          tools: [],
          skills: [{ domain: 'outlook', recommendedEntryTools: ['outlook_search_emails'] }],
        },
      },
    ]);

    expect(override).toBe('primary');
  });

  it('does not apply a discovery-driven model override when matched skills disagree', async () => {
    const { getDiscoveryFollowUpModelOverride } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const override = getDiscoveryFollowUpModelOverride([
      {
        toolName: 'helkin_skill_search',
        success: true,
        result: {
          tools: [],
          skills: [
            { domain: 'outlook', recommendedEntryTools: ['outlook_search_emails'] },
            { domain: 'weather', recommendedEntryTools: ['weather_get'] },
          ],
        },
      },
    ]);

    expect(override).toBeUndefined();
  });

  it('returns an honest discovery dead-end message instead of a generic no-op', async () => {
    const { buildDiscoveryDeadEndResponse, isDiscoveryOnlyDeadEnd } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const toolResults = [
      {
        toolName: 'helkin_skill_search',
        success: true,
        result: {
          tools: [],
          skills: [],
        },
      },
    ];

    expect(isDiscoveryOnlyDeadEnd(toolResults)).toBe(true);
    expect(buildDiscoveryDeadEndResponse('Schedule lunch tomorrow at 12:30')).toContain('have not created an event');
  });

  it('builds a deterministic read-only discovery response without claiming any action was executed', async () => {
    const { buildReadOnlyDiscoveryResponse } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const response = buildReadOnlyDiscoveryResponse([
      {
        toolName: 'helkin_skill_search',
        success: true,
        result: {
          command: 'search',
          query: 'search mailbox emails',
          skills: [{ domain: 'outlook', displayName: 'Outlook', shortDescription: 'Email and calendar management' }],
          tools: [{
            name: 'outlook_search_emails',
            domain: 'outlook',
            description: 'search email',
            risk: 'low',
          }],
        },
      },
    ], 'Use discovery only and tell me which tool you would use to search mailbox emails. Do not execute any non-discovery tools.');

    expect(response).toContain('I stayed in discovery-only mode.');
    expect(response).toContain('`outlook_search_emails`');
    expect(response).toContain('No non-discovery tools were executed.');
  });

  it('synthesizes a deterministic calendar-event follow-up call for the issue #394 prompt shape', async () => {
    const { synthesizeDeterministicFollowUpToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeDeterministicFollowUpToolCall(
      '/heavy please put a new meeting in my calendar to have lunch with a friend tomorrow at 12:30 with a reminder 15 minutes before. This is issue 394 primary model validation.',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_create_calendar_event',
            description: 'create calendar event',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call?.name).toBe('outlook_create_calendar_event');
    expect(call?.arguments).toMatchObject({
      subject: 'Lunch with a friend',
      reminderMinutesBeforeStart: 15,
      isReminderOn: true,
    });
    expect(typeof call?.arguments['start']).toBe('string');
    expect(typeof call?.arguments['end']).toBe('string');
  });

  it('synthesizes a deterministic send-email follow-up call for explicit quoted send intents', async () => {
    const { synthesizeDeterministicFollowUpToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeDeterministicFollowUpToolCall(
      'Send an email to eric@example.com with subject "Hello" and body "World"',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_send_email',
            description: 'send email',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_send_email',
      arguments: {
        to: ['eric@example.com'],
        subject: 'Hello',
        body: 'World',
        bodyType: 'text',
      },
    });
  });
});