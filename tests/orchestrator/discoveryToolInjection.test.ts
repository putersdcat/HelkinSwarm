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
    capabilityGroups: [
      {
        id: 'mail-read',
        displayName: 'Mail Read Operations',
        shortDescription: 'Read mailbox content',
        discoveryHints: ['mailbox', 'attachments'],
        useWhen: ['inspect or find email'],
        upstreamNamespace: 'mail.read',
        upstreamToolSelectors: ['search', 'attachments'],
      },
      {
        id: 'calendar',
        displayName: 'Calendar Operations',
        shortDescription: 'Create and inspect events',
        discoveryHints: ['calendar'],
        useWhen: ['schedule meetings'],
        upstreamNamespace: 'calendar',
        upstreamToolSelectors: ['create-event'],
      },
    ],
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
        capabilityGroup: 'mail-read',
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
        capabilityGroup: 'calendar',
      },
    ],
  },
  {
    domain: 'graphenterprise',
    version: '1.0',
    shortName: 'graphenterprise',
    displayName: 'Graph Enterprise',
    shortDescription: 'Enterprise Microsoft Graph tenant reporting',
    iconUrl: 'https://example.com/graphenterprise.png',
    deploymentScenario: 'enterprise-commercial',
    onboardingMethod: 'automatic-agentic',
    lifecycleRules: 'keep-credentials',
    requiredPermissions: ['Directory.Read.All'],
    discoveryHints: ['entra', 'directory', 'tenant reporting'],
    orchestratorUseCases: ['inspect tenant-wide graph metadata'],
    recommendedEntryTools: ['graphenterprise_list_properties'],
    tools: [
      {
        name: 'graphenterprise_list_properties',
        description: 'list graph enterprise properties',
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
  toolRegistry.register({
    name: 'graphenterprise_list_properties',
    description: 'list graph enterprise properties',
    risk: 'low',
    dataSensitivity: 'non-pii',
    requiresConfirmation: false,
    requiresExecutor: false,
    requiresSubAgent: false,
    privilegeClass: 'read-only',
    inputSchema: { type: 'object', properties: {}, required: [] },
  });
}

describe('discoveryToolInjection', () => {
  beforeEach(async () => {
    await seedRegistry();
  });

  it('keeps the initial discovery-first tool surface core-only for non-proof prompts', async () => {
    const { deriveContextAwareInitialToolSchemas } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const initial = deriveContextAwareInitialToolSchemas('hello there', [
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
          name: 'helkin_health_check',
          description: 'health',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'outlook_search_emails',
          description: 'search email',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ]);

    expect(initial.map((tool) => tool.function.name)).toEqual([
      'helkin_skill_search',
      'helkin_health_check',
    ]);
  });

  it('widens the initial tool surface for proof-style Outlook follow-ups so the surfaced mailbox tool can execute immediately', async () => {
    const { deriveContextAwareInitialToolSchemas } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const initial = deriveContextAwareInitialToolSchemas(
      'Please do a simple functional test of the skill and output the results. [Quoted context] Best matching tool: outlook_search_emails (outlook, risk: low).',
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
            name: 'helkin_health_check',
            description: 'health',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
        {
          type: 'function',
          function: {
            name: 'outlook_search_emails',
            description: 'search email',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(initial.map((tool) => tool.function.name)).toEqual([
      'helkin_skill_search',
      'helkin_health_check',
      'outlook_search_emails',
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

  it('narrows second-hop tool schemas from matched capability groups', async () => {
    const { deriveSelectiveFollowUpToolSchemas } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const tools = deriveSelectiveFollowUpToolSchemas([
      {
        toolName: 'helkin_skill_search',
        success: true,
        result: {
          capabilityGroups: [{ id: 'outlook/mail-read' }],
          tools: [],
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

  it('does not collapse a proof follow-up back into read-only discovery when raw Teams text is polluted by quoted preview text', async () => {
    const {
      isReadOnlyDiscoveryRequest,
      synthesizeDeterministicReadOnlyInitialToolCall,
    } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const contaminatedPrompt = 'HelkinSwarm I checked the installed skills without executing anything yet Best matching capability group: outlook/mail-read (outlook) Search, read, and inspect mailbox messages and attachments status: action-required Best matching tool: outlook_search_emails (outlook, risk: low) Search emails across th /light Please do a simple functional test of the skill and output the results. End with EXACT-578-LIGHT-20260407.';

    expect(isReadOnlyDiscoveryRequest(contaminatedPrompt)).toBe(false);

    const call = synthesizeDeterministicReadOnlyInitialToolCall(
      contaminatedPrompt,
      [
        {
          type: 'function',
          function: {
            name: 'outlook_search_emails',
            description: 'search emails',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_search_emails',
      arguments: {
        query: 'hasAttachment:true',
        folder: 'inbox',
        top: 5,
      },
    });
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

  it('forces an explicit core tool on the initial turn instead of falling back to helkin_skill_search', async () => {
    const { getForcedInitialToolChoice } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const choice = getForcedInitialToolChoice(
      'Use the exact tool helkin_mcp_forge with command "draft_candidate" and candidateName "io.github.j0hanz/filesystem-mcp".',
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
            name: 'helkin_mcp_forge',
            description: 'draft and approve MCP onboarding bundles',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(choice).toEqual({ type: 'function', function: { name: 'helkin_mcp_forge' } });
  });

  it('still forces helkin_skill_search on the initial turn for generic external-action intents without an explicit core tool', async () => {
    const { getForcedInitialToolChoice } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const choice = getForcedInitialToolChoice(
      'Send an email to Eric about the deployment status.',
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
            name: 'helkin_mcp_forge',
            description: 'draft and approve MCP onboarding bundles',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(choice).toEqual({ type: 'function', function: { name: 'helkin_skill_search' } });
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

  it('prefers outlook_list_emails for recent mailbox listing intents instead of falling through to outlook_send_email', async () => {
    const { getForcedDiscoveryFollowUpToolChoice } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const choice = getForcedDiscoveryFollowUpToolChoice(
      'Please list my most recent 5 emails, return only bullet points of the subject lines.',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_list_emails',
            description: 'list recent emails',
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

    expect(choice).toEqual({ type: 'function', function: { name: 'outlook_list_emails' } });
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

  it('keeps non-chat-recoverable skills out of the post-discovery execution subset', async () => {
    const { deriveSelectiveFollowUpToolSchemas } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const tools = deriveSelectiveFollowUpToolSchemas([
      {
        toolName: 'helkin_skill_search',
        success: true,
        result: {
          tools: [{ name: 'graphenterprise_list_properties', domain: 'graphenterprise' }],
          skills: [{
            domain: 'graphenterprise',
            operationalState: 'operator-setup-required',
            recommendedEntryTools: ['graphenterprise_list_properties'],
          }],
        },
      },
    ]);

    expect(tools?.map((tool) => tool.function.name)).toEqual([
      'helkin_skill_search',
      'helkin_health_check',
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
    expect(buildDiscoveryDeadEndResponse('Schedule lunch tomorrow at 12:30')).toContain('did not reach a runnable calendar action yet');
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
          capabilityGroups: [{
            id: 'outlook/mail-read',
            domain: 'outlook',
            displayName: 'Mail Read Operations',
            shortDescription: 'Read mailbox content',
            toolCount: 1,
          }],
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

    expect(response).toContain('I checked the installed skills without executing anything yet.');
    expect(response).toContain('`outlook/mail-read`');
    expect(response).toContain('`outlook_search_emails`');
    expect(response).toContain('status: action-required');
    expect(response).toContain('I have not run the underlying skill yet.');
  });

  it('builds a context-aware routing message for proof-style follow-ups using quoted or recent assistant context', async () => {
    const { buildContextAwareRoutingMessage } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const routed = buildContextAwareRoutingMessage(
      'please do a simple functional test of the skill and output the results',
      {
        quotedText: 'Microsoft Graph Enterprise MCP is available. Recommended entry tools: graphenterprise_suggest_queries, graphenterprise_get.',
        recentUserText: 'Tell me the current status of the Microsoft Graph Enterprise MCP skill and keep it concise.',
        recentAssistantText: 'Best matching skill: Microsoft Graph Enterprise MCP `graphenterprise`.',
      },
    );

    expect(routed).toContain('functional test');
    expect(routed).toContain('graphenterprise_suggest_queries');
    expect(routed).toContain('current status of the Microsoft Graph Enterprise MCP skill');
    expect(routed).toContain('Best matching skill');
  });

  it('synthesizes the Outlook proof call from recent user context even when quoted context is truncated or generic', async () => {
    const {
      buildContextAwareRoutingMessage,
      synthesizeDeterministicReadOnlyInitialToolCall,
    } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const routed = buildContextAwareRoutingMessage(
      'Please do a simple functional test of the skill and output the results.',
      {
        quotedText: 'I checked the installed skills without executing anything yet.',
        recentUserText: 'Use discovery only and tell me which tool you would use to search mailbox emails. Do not execute any non-discovery tools.',
      },
    );

    const call = synthesizeDeterministicReadOnlyInitialToolCall(
      routed,
      [
        {
          type: 'function',
          function: {
            name: 'outlook_search_emails',
            description: 'search emails',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_search_emails',
      arguments: {
        query: 'hasAttachment:true',
        folder: 'inbox',
        top: 5,
      },
    });
  });

  it('does not misclassify proof prompts as read-only discovery just because injected quote context contains old discovery wording', async () => {
    const {
      buildContextAwareRoutingMessage,
      isReadOnlyDiscoveryRequest,
    } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const routed = buildContextAwareRoutingMessage(
      'Please do a simple functional test of the skill and output the results.',
      {
        quotedText: 'I checked the installed skills without executing anything yet. Best matching tool: outlook_search_emails (outlook, risk: low).',
        recentAssistantText: 'Best matching skill: Outlook `outlook`.',
      },
    );

    expect(isReadOnlyDiscoveryRequest(routed)).toBe(false);
  });

  it('does not misclassify proof prompts as read-only discovery when recent user context carries the prior discovery-only setup text', async () => {
    const {
      buildContextAwareRoutingMessage,
      buildReadOnlyDiscoveryQuery,
      isReadOnlyDiscoveryRequest,
    } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const routed = buildContextAwareRoutingMessage(
      'Please do a simple functional test of the skill and output the results.',
      {
        recentUserText: 'Use discovery only and tell me which tool you would use to search mailbox emails. Do not execute any non-discovery tools.',
      },
    );

    expect(isReadOnlyDiscoveryRequest(routed)).toBe(false);
    expect(buildReadOnlyDiscoveryQuery(routed)).toBe('Please do a simple functional test of the skill and output the results');
  });

  it('synthesizes a deterministic read-only initial call for natural Outlook mailbox-search prompts', async () => {
    const { synthesizeDeterministicReadOnlyInitialToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeDeterministicReadOnlyInitialToolCall(
      '/light Search my Outlook inbox for emails with attachments. Return only the top 5 message ids, subjects, and receivedAt values as compact JSON.',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_search_emails',
            description: 'search emails',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_search_emails',
      arguments: {
        query: 'hasAttachment:true',
        folder: 'inbox',
        top: 5,
      },
    });
  });

  it('does not synthesize a non-discovery Outlook call when the prompt explicitly demands discovery-only mode', async () => {
    const { synthesizeDeterministicReadOnlyInitialToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeDeterministicReadOnlyInitialToolCall(
      '/light Use discovery only and tell me which tool you would use to search mailbox emails. Do not execute any non-discovery tools.',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_search_emails',
            description: 'search emails',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toBeNull();
  });

  it('synthesizes a deterministic graphenterprise verification call when a proof prompt carries prior skill context', async () => {
    const { synthesizeDeterministicReadOnlyInitialToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeDeterministicReadOnlyInitialToolCall(
      'please do a simple functional test of the skill and output the results\n\n[Quoted context]\nMicrosoft Graph Enterprise MCP is available. Recommended entry tools: graphenterprise_suggest_queries, graphenterprise_get.',
      [
        {
          type: 'function',
          function: {
            name: 'graphenterprise_list_properties',
            description: 'list graph entity properties',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'graphenterprise_list_properties',
      arguments: {
        entity: 'user',
      },
    });
  });

  it('synthesizes a deterministic Outlook proof call even when the quoted context includes previous discovery-only wording', async () => {
    const { synthesizeDeterministicReadOnlyInitialToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeDeterministicReadOnlyInitialToolCall(
      'Please do a simple functional test of the skill and output the results\n\n[Quoted context]\nI checked the installed skills without executing anything yet. Best matching capability group: outlook/mail-read (outlook). Best matching tool: outlook_search_emails (outlook, risk: low).',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_search_emails',
            description: 'search emails',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_search_emails',
      arguments: {
        query: 'hasAttachment:true',
        folder: 'inbox',
        top: 5,
      },
    });
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

  it('synthesizes a deterministic mailbox search follow-up call for attachment-search prompts', async () => {
    const { synthesizeDeterministicFollowUpToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeDeterministicFollowUpToolCall(
      '/light Search my Outlook inbox for emails with attachments. Return only the top 5 message ids, subjects, and receivedAt values as compact JSON.',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_search_emails',
            description: 'search emails',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_search_emails',
      arguments: {
        query: 'hasAttachment:true',
        folder: 'inbox',
        top: 5,
      },
    });
  });

  it('synthesizes a deterministic mailbox list follow-up call for recent email listing prompts', async () => {
    const { synthesizeDeterministicFollowUpToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeDeterministicFollowUpToolCall(
      'Please list my most recent 5 emails, return only bullet points of the subject lines.',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_list_emails',
            description: 'list recent emails',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_list_emails',
      arguments: {
        top: 5,
      },
    });
  });

  it('synthesizes a deterministic exact-tool call for non-core follow-up prompts once discovery surfaced the tool', async () => {
    const { synthesizeExactToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeExactToolCall(
      'Use the exact tool outlook_list_attachments with messageId "msg-123". Return only compact JSON with messageId and attachments.',
      [
        {
          type: 'function',
          function: {
            name: 'outlook_list_attachments',
            description: 'list attachments',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_list_attachments',
      arguments: {
        messageId: 'msg-123',
      },
    });
  });

  it('synthesizes a deterministic exact-tool call for non-core initial-turn prompts too', async () => {
    const { synthesizeExactToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeExactToolCall(
      'Use the exact tool outlook_list_attachments with messageId "msg-123". Return only compact JSON with messageId and attachments.',
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
            name: 'outlook_list_attachments',
            description: 'list attachments',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_list_attachments',
      arguments: {
        messageId: 'msg-123',
      },
    });
  });

  it('synthesizes an inline-email tool call when image runtime assets are present for a natural send request', async () => {
    const { synthesizeRuntimeAssetInlineEmailToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeRuntimeAssetInlineEmailToolCall(
      'can you send an email to my private address eric@eanderson.de with the image below inline.',
      [
        {
          version: 1,
          id: '11111111-1111-4111-8111-111111111111',
          userId: 'user-1',
          correlationId: 'corr-1',
          kind: 'image',
          contentType: 'image/png',
          fileName: 'photo.png',
          byteLength: 1024,
          sha256: 'a'.repeat(64),
          source: { channel: 'teams', attachmentKind: 'inline-image' },
          createdAt: '2026-04-02T00:00:00.000Z',
          expiresAt: '2026-04-02T06:00:00.000Z',
          ttlSeconds: 21600,
          storage: {
            container: 'helkinswarm-runtime-assets',
            payloadBlobPath: 'payload/photo.png',
            metadataBlobPath: 'metadata/photo.json',
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_send_email',
      arguments: {
        to: ['eric@eanderson.de'],
        subject: 'Inline image from HelkinSwarm',
        body: '<p>Here is the inline image you requested.</p><img src="cid:photo" />',
        bodyType: 'html',
        inlineAssets: [
          {
            assetId: '11111111-1111-4111-8111-111111111111',
            contentId: 'photo',
            fileName: 'photo.png',
          },
        ],
      },
    });
  });

  it('prefers explicit subject and cid when synthesizing inline-email tool calls from runtime assets', async () => {
    const { synthesizeRuntimeAssetInlineEmailToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeRuntimeAssetInlineEmailToolCall(
      'Use the exact tool outlook_send_email. Send an HTML email to eric@eanderson.de with subject "DL-inline-selftest-1234". The body must contain a short intro paragraph plus an inline image using <img src="cid:asset-ingest-selftest" />. Use the runtime asset for `asset-ingest-selftest.png` as inlineAssets with contentId `asset-ingest-selftest`.',
      [
        {
          version: 1,
          id: '22222222-2222-4222-8222-222222222222',
          userId: 'user-1',
          correlationId: 'corr-2',
          kind: 'image',
          contentType: 'image/png',
          fileName: 'asset-ingest-selftest.png',
          byteLength: 1024,
          sha256: 'b'.repeat(64),
          source: { channel: 'teams', attachmentKind: 'inline-image' },
          createdAt: '2026-04-02T00:00:00.000Z',
          expiresAt: '2026-04-02T06:00:00.000Z',
          ttlSeconds: 21600,
          storage: {
            container: 'helkinswarm-runtime-assets',
            payloadBlobPath: 'payload/selftest.png',
            metadataBlobPath: 'metadata/selftest.json',
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'outlook_send_email',
      arguments: {
        to: ['eric@eanderson.de'],
        subject: 'DL-inline-selftest-1234',
        body: '<p>Here is the inline image you requested.</p><img src="cid:asset-ingest-selftest" />',
        bodyType: 'html',
        inlineAssets: [
          {
            assetId: '22222222-2222-4222-8222-222222222222',
            contentId: 'asset-ingest-selftest',
            fileName: 'asset-ingest-selftest.png',
          },
        ],
      },
    });
  });

  it('synthesizes a deterministic exact-tool call for structured core-tool validation prompts', async () => {
    const { synthesizeExactToolCall } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const call = synthesizeExactToolCall(
      '/heavy Use the exact tool helkin_mcp_forge with command "approve_bundle" and bundlePath "bundles/demo.json". Return only compact JSON with status and skillId.',
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
            name: 'helkin_mcp_forge',
            description: 'draft and approve MCP onboarding bundles',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ],
    );

    expect(call).toEqual({
      name: 'helkin_mcp_forge',
      arguments: {
        command: 'approve_bundle',
        bundlePath: 'bundles/demo.json',
      },
    });
  });

  it('builds a deterministic compact JSON response for explicit exact-tool prompts', async () => {
    const { buildDeterministicExactToolResponse } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const response = buildDeterministicExactToolResponse(
      'Use the exact tool helkin_mcp_forge with command "approve_bundle" and bundlePath "bundles/demo.json". Return only compact JSON with status, skillId, manifestPath, smokeTest.toolCount, and reloadSummary.errors.',
      [
        {
          toolName: 'helkin_mcp_forge',
          success: true,
          result: {
            status: 'approved-local',
            skillId: 'mcp-demo',
            manifestPath: 'skills/custom/mcp-demo/manifest.json',
            smokeTest: { toolCount: 7, toolNames: ['a'] },
            reloadSummary: { errors: [] },
            ignored: true,
          },
        },
      ],
    );

    expect(response).toBe('{"status":"approved-local","skillId":"mcp-demo","manifestPath":"skills/custom/mcp-demo/manifest.json","smokeTest":{"toolCount":7},"reloadSummary":{"errors":[]}}');
  });

  it('does not short-circuit natural compact-json prompts into a discovery payload when no exact tool was requested', async () => {
    const { buildDeterministicExactToolResponse } = await import('../../src/orchestrator/discoveryToolInjection.js');

    const response = buildDeterministicExactToolResponse(
      'Search my Outlook inbox for emails with attachments. Return only compact JSON with message ids, subjects, and receivedAt values.',
      [
        {
          toolName: 'helkin_skill_search',
          success: true,
          result: {
            tools: [{ name: 'outlook_search_emails' }],
            skills: [{ domain: 'outlook' }],
          },
        },
      ],
    );

    expect(response).toBeNull();
  });
});