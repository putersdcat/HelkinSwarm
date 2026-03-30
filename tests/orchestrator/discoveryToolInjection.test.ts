import { beforeEach, describe, expect, it } from 'vitest';

async function seedRegistry(): Promise<void> {
  process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.cognitiveservices.azure.com';
  process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

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
    expect(shouldForceDiscoveryToolSearch('hello there')).toBe(false);
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