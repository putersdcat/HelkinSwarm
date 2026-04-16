// Core skill handlers — built-in tools that are always available.
// Spec ref: 05-Capabilities-Framework.md
// Each export matches a tool name from manifest.json.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';

function resolveTimeZone(timezone: string | undefined): string {
  if (!timezone) {
    return 'UTC';
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date('2026-04-09T00:00:00.000Z'));
    return timezone;
  } catch {
    return 'UTC';
  }
}

function formatDateTimeSnapshot(now: Date, timezone: string): {
  timezone: string;
  isoUtc: string;
  date: string;
  time: string;
  weekday: string;
} {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(now);

  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(now);

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(now);

  return {
    timezone,
    isoUtc: now.toISOString(),
    date,
    time,
    weekday,
  };
}

function getRecentUserRequests(recentHistory: Array<{ role: 'user' | 'assistant'; content: string }> | undefined, count: number): string[] {
  return (recentHistory ?? [])
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content.trim())
    .filter((content) => content.length > 0)
    .slice(-count);
}

export const helkin_health_check: ToolHandler = async (_args) => {
  const euMode = process.env['EU_RESIDENCY_MODE'] === 'true';
  const safetyMode = process.env['SAFETY_MODE'] ?? 'confirmation-gated';

  let memoryStatus: 'ok' | 'pending' = 'pending';
  try {
    const { getDatabase } = await import('../../src/memory/cosmosClient.js');
    await getDatabase().read();
    memoryStatus = 'ok';
  } catch {
    // Cosmos not reachable — report pending
  }

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: (await import('../../src/config/version.js')).APP_VERSION,
    components: {
      runtime: 'ok',
      overseer: 'ok',
      llm: 'ok',
      memory: memoryStatus,
    },
    safetyMode,
    euResidencyMode: euMode,
  };
};

export const helkin_list_skills: ToolHandler = async () => {
  const { toolRegistry } = await import('../../src/tools/toolRegistry.js');
  const { getDiscoverySkill } = await import('../../src/capabilities/skillDiscoveryIndex.js');

  const tools = toolRegistry.getAll();
  const domains = new Map<string, {
    toolCount: number;
    tools: string[];
    displayName?: string;
    operationalState?: string;
    operationalSummary?: string;
  }>();

  for (const tool of tools) {
    const domain = tool.name.split('_')[0] ?? 'unknown';
    const discoverySkill = getDiscoverySkill(domain);
    const entry = domains.get(domain) ?? {
      toolCount: 0,
      tools: [],
      displayName: discoverySkill?.displayName,
      operationalState: discoverySkill?.operationalState,
      operationalSummary: discoverySkill?.operationalSummary,
    };
    entry.toolCount++;
    entry.tools.push(tool.name);
    domains.set(domain, entry);
  }

  return {
    totalTools: tools.length,
    domains: Object.fromEntries(domains),
  };
};

export const helkin_current_datetime: ToolHandler = async (args) => {
  const { getUserProfile } = await import('../../src/memory/userProfile.js');

  const userId = typeof args['userId'] === 'string' ? args['userId'] : undefined;
  const profile = userId ? await getUserProfile(userId) : undefined;
  const requestedTimezone = typeof args['timezone'] === 'string' ? args['timezone'] : undefined;
  const timezone = resolveTimeZone(requestedTimezone ?? profile?.timezone);
  const snapshot = formatDateTimeSnapshot(new Date(), timezone);

  return {
    status: 'success',
    ...snapshot,
    message: `Today is ${snapshot.date}. The current time is ${snapshot.time}.`,
  };
};

export const helkin_recent_requests: ToolHandler = async (args) => {
  const { loadState } = await import('../../src/orchestrator/stateManager.js');

  const userId = typeof args['userId'] === 'string' ? args['userId'] : undefined;
  if (!userId) {
    return { status: 'error', message: 'userId is required to inspect recent requests.' };
  }

  const state = await loadState(userId);
  const requestedCount = typeof args['count'] === 'number' ? args['count'] : Number(args['count'] ?? 2);
  const count = Number.isFinite(requestedCount)
    ? Math.min(10, Math.max(1, Math.trunc(requestedCount)))
    : 2;
  const requests = getRecentUserRequests(state?.recentHistory, count);

  return {
    status: 'success',
    count: requests.length,
    requestedCount: count,
    requests,
    message: requests.length > 0
      ? `Most recent user requests: ${requests.map((request) => `"${request}"`).join('; ')}`
      : 'No recent user requests are available in active session history.',
  };
};

export const helkin_skill_search: ToolHandler = async (args) => {
  const { getDiscoveryCapabilityGroup, getDiscoverySkill, getDiscoveryTool, getSkillDiscoveryIndex, searchSkillDiscoveryIndex } = await import('../../src/capabilities/skillDiscoveryIndex.js');
  const { toolRegistry } = await import('../../src/tools/toolRegistry.js');
  const { trackEvent } = await import('../../src/observability/telemetry.js');

  const command = String(args['command'] ?? 'help');
  const correlationId = String(args['correlationId'] ?? crypto.randomUUID());
  const userId = typeof args['userId'] === 'string' ? args['userId'] : undefined;

  if (command === 'help') {
    return {
      status: 'success',
      command: 'help',
      usage: [
        'command=help',
        'command=search query="email search github issue"',
        'command=describe_group groupId="outlook/mail-read"',
        'command=describe_skill skillId="outlook"',
        'command=describe_tool toolName="outlook_search_emails"',
        'command=list_domains',
        'command=list_groups',
      ],
      notes: [
        'Discovery-only tool — it never executes skills directly.',
        'Use search first, then describe_skill or describe_tool for more detail.',
      ],
    };
  }

  if (command === 'search') {
    const query = String(args['query'] ?? '').trim();
    if (!query) {
      return { status: 'error', message: 'query is required when command=search.' };
    }

    const result = searchSkillDiscoveryIndex(query, {
      skillLimit: Number(args['skillLimit'] ?? 5),
      toolLimit: Number(args['toolLimit'] ?? 8),
    });

    const localMiss = result.skills.length === 0 && result.tools.length === 0;

    trackEvent({
      name: 'DiscoveryQueryExecuted',
      correlationId,
      userId,
      properties: {
        query,
        skillCount: result.skills.length,
        toolCount: result.tools.length,
        selectedTools: result.tools.map((tool) => tool.id).join(','),
        localMiss: String(localMiss),
      },
    });

    // ---------------------------------------------------------------------------
    // When local search returns nothing, compute enriched zero-result guidance
    // so the LLM can reason about reformulation rather than repeating the same
    // failing query. Satisfies issue #629.
    // ---------------------------------------------------------------------------
    const queryTokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);

    // ---------------------------------------------------------------------------
    // Registry fallback: when no installed skills match, attempt MCP Registry
    // candidate discovery as a second-hop. Candidates are clearly labeled
    // external and never auto-activated. Satisfies issue #482.
    // ---------------------------------------------------------------------------
    let registryFallbackCandidates: Array<{
      name: string;
      title: string | null;
      description: string;
      activationGate: unknown;
      score: number;
    }> | undefined;

    if (localMiss) {
      try {
        const { searchMcpRegistryCatalog } = await import('../../src/mcp/mcpRegistryCatalog.js');
        const registryResult = await searchMcpRegistryCatalog(query, {
          limit: 5,
          includeDeleted: false,
          includeDeprecated: false,
          forceRefresh: false,
        });
        if (registryResult.candidates.length > 0) {
          registryFallbackCandidates = registryResult.candidates.map((c) => ({
            name: c.name,
            title: c.title,
            description: c.description,
            activationGate: c.activationGate,
            score: c.score,
          }));
          trackEvent({
            name: 'DiscoveryRegistryFallbackUsed',
            correlationId,
            userId,
            properties: {
              query,
              candidateCount: String(registryFallbackCandidates.length),
            },
          });
        }
      } catch {
        // Registry fallback is best-effort — local miss result is still returned.
      }
    }

    return {
      status: 'success',
      command: 'search',
      query,
      generatedAt: result.generatedAt,
      skills: result.skills.map((hit) => {
        const skill = getDiscoverySkill(hit.id);
        return {
          domain: hit.domain,
          displayName: skill?.displayName ?? hit.id,
          shortDescription: skill?.shortDescription ?? '',
          operationalState: skill?.operationalState ?? 'operational',
          operationalSummary: skill?.operationalSummary ?? '',
          recommendedEntryTools: skill?.recommendedEntryTools ?? [],
          score: hit.score,
          matchReasons: hit.matchReasons,
        };
      }),
      capabilityGroups: result.capabilityGroups.map((hit) => {
        const group = getDiscoveryCapabilityGroup(hit.id);
        const skill = getDiscoverySkill(hit.domain);
        return {
          id: hit.id,
          domain: hit.domain,
          displayName: group?.displayName ?? hit.id,
          shortDescription: group?.shortDescription ?? '',
          operationalState: skill?.operationalState ?? 'operational',
          operationalSummary: skill?.operationalSummary ?? '',
          toolCount: group?.toolCount ?? 0,
          toolNames: group?.toolNames ?? [],
          upstreamNamespace: group?.upstreamNamespace ?? null,
          score: hit.score,
          matchReasons: hit.matchReasons,
        };
      }),
      tools: result.tools.map((hit) => {
        const tool = getDiscoveryTool(hit.id);
        const skill = getDiscoverySkill(hit.domain);
        return {
          name: hit.id,
          domain: hit.domain,
          description: tool?.description ?? '',
          risk: tool?.risk ?? 'low',
          skillOperationalState: skill?.operationalState ?? 'operational',
          skillOperationalSummary: skill?.operationalSummary ?? '',
          allowedModelLane: tool?.allowedModelLane ?? 'any',
          safetyCompatible: tool ? toolRegistry.isAllowedBySafetyMode(tool.name) : false,
          score: hit.score,
          matchReasons: hit.matchReasons,
        };
      }),
      // Always surface zero_result_guidance when local search produced nothing (#629).
      // This replaces the opaque local_miss flag with actionable LLM-readable context:
      // query tokens, why they failed, reformulation examples, and all installed domains.
      ...(localMiss && {
        local_miss: true,
        zero_result_guidance: {
          query_tokens_searched: queryTokens,
          what_happened: `None of the tokens [${queryTokens.join(', ')}] matched any installed skill's discoveryTerms, discoveryHints, or tool descriptions. The local skill index uses token-based exact substring matching.`,
          how_to_recover: [
            'Reformulate using a direct capability category name rather than the original domain words.',
            'For public internet / web lookups or local business searches → try: command=search query="web search"',
            'For email, inbox, or calendar → try: command=search query="outlook email"',
            'For GitHub repos, issues, or pull requests → try: command=search query="github"',
            'For deep research or multi-angle web research → try: command=search query="research"',
            'For weather or forecast → try: command=search query="weather"',
            'For math or calculations → try: command=search query="math"',
            'For language translation → try: command=search query="translate"',
            'Alternatively, use command=list_domains to see every installed skill domain.',
            'Do NOT repeat the same query tokens — change to the capability type you actually need.',
          ],
          installed_domains: getSkillDiscoveryIndex().skills.map((s) => ({
            domain: s.domain,
            displayName: s.displayName,
            operationalState: s.operationalState,
          })),
        },
      }),
      ...(registryFallbackCandidates !== undefined && registryFallbackCandidates.length > 0 && {
        registry_fallback_candidates: registryFallbackCandidates,
        registry_fallback_note: 'These are EXTERNAL MCP candidates — not installed. They require explicit onboarding via helkin_mcp_forge before use.',
      }),
    };
  }

  if (command === 'describe_group') {
    const groupId = String(args['groupId'] ?? '').trim();
    if (!groupId) {
      return { status: 'error', message: 'groupId is required when command=describe_group.' };
    }

    const group = getDiscoveryCapabilityGroup(groupId);
    if (!group) {
      return { status: 'not-found', message: `No capability group found for '${groupId}'.`, groupId };
    }

    return {
      status: 'success',
      command: 'describe_group',
      groupId: group.id,
      domain: group.domain,
      displayName: group.displayName,
      shortDescription: group.shortDescription,
      discoveryHints: group.discoveryHints,
      useWhen: group.useWhen,
      operationalState: getDiscoverySkill(group.domain)?.operationalState ?? 'operational',
      operationalSummary: getDiscoverySkill(group.domain)?.operationalSummary ?? '',
      toolNames: group.toolNames,
      toolCount: group.toolCount,
      upstreamNamespace: group.upstreamNamespace ?? null,
      upstreamToolSelectors: group.upstreamToolSelectors,
    };
  }

  if (command === 'describe_skill') {
    const skillId = String(args['skillId'] ?? '').trim();
    if (!skillId) {
      return { status: 'error', message: 'skillId is required when command=describe_skill.' };
    }

    const skill = getDiscoverySkill(skillId);
    if (!skill) {
      return { status: 'not-found', message: `No skill found for '${skillId}'.`, skillId };
    }

    return {
      status: 'success',
      command: 'describe_skill',
      skill: skill.domain,
      displayName: skill.displayName,
      shortDescription: skill.shortDescription,
      operationalState: skill.operationalState,
      operationalSummary: skill.operationalSummary,
      discoveryHints: skill.discoveryHints,
      orchestratorUseCases: skill.orchestratorUseCases,
      recommendedEntryTools: skill.recommendedEntryTools,
      modelAffinity: skill.modelAffinity ?? null,
      toolNames: skill.toolNames,
      toolCount: skill.toolCount,
    };
  }

  if (command === 'describe_tool') {
    const toolName = String(args['toolName'] ?? '').trim();
    if (!toolName) {
      return { status: 'error', message: 'toolName is required when command=describe_tool.' };
    }

    const tool = getDiscoveryTool(toolName);
    if (!tool) {
      return { status: 'not-found', message: `No tool found for '${toolName}'.`, toolName };
    }

    return {
      status: 'success',
      command: 'describe_tool',
      toolName: tool.name,
      domain: tool.domain,
      skillOperationalState: getDiscoverySkill(tool.domain)?.operationalState ?? 'operational',
      skillOperationalSummary: getDiscoverySkill(tool.domain)?.operationalSummary ?? '',
      description: tool.description,
      risk: tool.risk,
      dataSensitivity: tool.dataSensitivity,
      allowedModelLane: tool.allowedModelLane,
      requiresConfirmation: tool.requiresConfirmation,
      requiresExecutor: tool.requiresExecutor,
      requiresSubAgent: tool.requiresSubAgent,
      privilegeClass: tool.privilegeClass,
      aliases: tool.aliases,
      discoveryTerms: tool.discoveryTerms,
      useWhen: tool.useWhen,
      avoidWhen: tool.avoidWhen,
      typicalInputs: tool.typicalInputs,
      returnsSummaryShape: tool.returnsSummaryShape ?? null,
      safetyCompatible: toolRegistry.isAllowedBySafetyMode(tool.name),
    };
  }

  if (command === 'list_domains') {
    const index = getSkillDiscoveryIndex();
    return {
      status: 'success',
      command: 'list_domains',
      domains: index.skills.map((skill) => ({
        domain: skill.domain,
        displayName: skill.displayName,
        shortDescription: skill.shortDescription,
        operationalState: skill.operationalState,
        operationalSummary: skill.operationalSummary,
        toolCount: skill.toolCount,
      })),
    };
  }

  if (command === 'list_groups') {
    const index = getSkillDiscoveryIndex();
    return {
      status: 'success',
      command: 'list_groups',
      groups: index.capabilityGroups.map((group) => ({
        id: group.id,
        domain: group.domain,
        displayName: group.displayName,
        shortDescription: group.shortDescription,
        toolCount: group.toolCount,
        upstreamNamespace: group.upstreamNamespace ?? null,
      })),
    };
  }

  return {
    status: 'error',
    message: `Unknown command '${command}'. Use command=help for supported operations.`,
  };
};

export const helkin_mcp_registry_search: ToolHandler = async (args) => {
  const { ensureFreshMcpRegistryCatalog, getMcpRegistryCatalogStatus, searchMcpRegistryCatalog } = await import('../../src/mcp/mcpRegistryCatalog.js');
  const { trackEvent } = await import('../../src/observability/telemetry.js');

  const command = String(args['command'] ?? 'help');
  const correlationId = String(args['correlationId'] ?? crypto.randomUUID());
  const userId = typeof args['userId'] === 'string' ? args['userId'] : undefined;

  if (command === 'help') {
    return {
      status: 'success',
      command: 'help',
      usage: [
        'command=help',
        'command=search query="azure key vault"',
        'command=status',
        'command=refresh',
      ],
      notes: [
        'Registry discovery is read-only and returns onboarding candidates, not installed skills.',
        'This tool stays separate from helkin_skill_search so local installed skills and external MCP candidates are not blurred together.',
        'Search uses a synced local in-process cache instead of hitting the registry on every call.',
      ],
    };
  }

  if (command === 'status') {
    return {
      status: 'success',
      command: 'status',
      catalog: getMcpRegistryCatalogStatus(),
    };
  }

  if (command === 'refresh') {
    const catalog = await ensureFreshMcpRegistryCatalog({ forceFull: Boolean(args['forceFull']) });
    trackEvent({
      name: 'McpRegistryCatalogRefreshed',
      correlationId,
      userId,
      properties: {
        mode: catalog.lastSyncMode ?? 'unknown',
        totalCached: String(catalog.totalCached),
        malformedDropped: String(catalog.malformedDropped),
      },
    });

    return {
      status: 'success',
      command: 'refresh',
      catalog,
    };
  }

  if (command === 'search') {
    const query = String(args['query'] ?? '').trim();
    if (!query) {
      return { status: 'error', message: 'query is required when command=search.' };
    }

    const result = await searchMcpRegistryCatalog(query, {
      limit: Number(args['limit'] ?? 8),
      includeDeleted: Boolean(args['includeDeleted']),
      includeDeprecated: args['includeDeprecated'] === undefined ? true : Boolean(args['includeDeprecated']),
      forceRefresh: Boolean(args['forceRefresh']),
    });

    trackEvent({
      name: 'McpRegistrySearchExecuted',
      correlationId,
      userId,
      properties: {
        query,
        returnedCandidates: String(result.candidates.length),
        usedStaleCache: String(result.usedStaleCache),
        totalCached: String(result.syncStatus.totalCached),
      },
    });

    return {
      status: 'success',
      command: 'search',
      query,
      generatedAt: result.generatedAt,
      usedStaleCache: result.usedStaleCache,
      excluded: result.excluded,
      syncStatus: result.syncStatus,
      candidates: result.candidates.map((candidate) => ({
        name: candidate.name,
        title: candidate.title,
        description: candidate.description,
        latestVersion: candidate.latestVersion,
        status: candidate.status,
        currentState: candidate.currentState,
        statusMessage: candidate.statusMessage,
        repositoryUrl: candidate.repositoryUrl,
        websiteUrl: candidate.websiteUrl,
        transportTypes: candidate.transportTypes,
        activationGate: candidate.activationGate,
        packageSummaries: candidate.packageSummaries,
        remoteSummaries: candidate.remoteSummaries,
        publishedAt: candidate.publishedAt,
        updatedAt: candidate.updatedAt,
        score: candidate.score,
        matchReasons: candidate.matchReasons,
      })),
    };
  }

  return {
    status: 'error',
    message: `Unknown command '${command}'. Use command=help for supported operations.`,
  };
};

export const helkin_mcp_forge: ToolHandler = async (args) => {
  const { buildMcpForgeDraftBundle, inspectMcpForgeBundle } = await import('../../src/mcp/mcpForgeDraft.js');
  const { approveMcpForgeBundleLocally } = await import('../../src/mcp/mcpForgeActivation.js');

  const command = String(args['command'] ?? 'help');

  if (command === 'help') {
    return {
      status: 'success',
      command: 'help',
      usage: [
        'command=help',
        'command=draft_candidate candidateName="com.microsoft/azure"',
        'command=approve_bundle bundlePath="bundles/<user>/<skill>/<id>.json"',
        'command=inspect_bundle bundlePath="bundles/<user>/<skill>/<id>.json"',
      ],
      notes: [
        'McpForge drafts review bundles for discovered MCP candidates and can locally approve them after smoke test passes.',
        'Locally approved MCP skills can later graduate back to source via the existing SkillForge GitHub App lane.',
      ],
    };
  }

  if (command === 'draft_candidate') {
    const candidateName = String(args['candidateName'] ?? '').trim();
    if (!candidateName) {
      return { status: 'error', message: 'candidateName is required when command=draft_candidate.' };
    }

    return buildMcpForgeDraftBundle({
      candidateName,
      userId: String(args['userId'] ?? 'anonymous'),
      correlationId: String(args['correlationId'] ?? crypto.randomUUID()),
      useCase: typeof args['useCase'] === 'string' ? args['useCase'] : undefined,
    });
  }

  if (command === 'approve_bundle') {
    const bundlePath = String(args['bundlePath'] ?? '').trim();
    if (!bundlePath) {
      return { status: 'error', message: 'bundlePath is required when command=approve_bundle.' };
    }

    return approveMcpForgeBundleLocally(bundlePath);
  }

  if (command === 'inspect_bundle') {
    const bundlePath = String(args['bundlePath'] ?? '').trim();
    if (!bundlePath) {
      return { status: 'error', message: 'bundlePath is required when command=inspect_bundle.' };
    }

    const bundle = await inspectMcpForgeBundle(bundlePath);
    return {
      status: 'success',
      command: 'inspect_bundle',
      bundle,
    };
  }

  return {
    status: 'error',
    message: `Unknown command '${command}'. Use command=help for supported operations.`,
  };
};

export const helkin_get_costs: ToolHandler = async (_args) => {
  const { getAzureResourceGroupCostSummary } = await import('../../src/integrations/azureCostManagement.js');
  return getAzureResourceGroupCostSummary();
};

// Zod schema for OpenRouter key API response (boundary validation)
const OpenRouterKeyDataSchema = z.object({
  label: z.string().optional(),
  limit: z.number().nullable().optional(),
  limit_remaining: z.number().nullable().optional(),
  usage: z.number(),
  usage_daily: z.number().optional(),
  usage_weekly: z.number().optional(),
  usage_monthly: z.number().optional(),
  is_free_tier: z.boolean().optional(),
  expires_at: z.string().nullable().optional(),
}).passthrough();

const OpenRouterKeyResponseSchema = z.object({
  data: OpenRouterKeyDataSchema,
});

export const helkin_get_openrouter_spend: ToolHandler = async (_args) => {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    return { status: 'unavailable', message: 'OPENROUTER_API_KEY not configured on this stamp.' };
  }

  const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    return {
      status: 'error',
      message: `OpenRouter API returned ${response.status} ${response.statusText}`,
    };
  }

  const rawJson = await response.json() as unknown;
  const parsed = OpenRouterKeyResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    return { status: 'error', message: 'OpenRouter API response parsing failed.' };
  }

  const d = parsed.data.data;
  const limitUsd = d.limit ?? null;
  const remainingUsd = d.limit_remaining ?? null;

  return {
    status: 'success',
    provider: 'openrouter',
    label: d.label ?? 'unknown',
    usageMonthlyUsd: d.usage_monthly ?? d.usage,
    usageWeeklyUsd: d.usage_weekly ?? null,
    usageDailyUsd: d.usage_daily ?? null,
    totalUsageUsd: d.usage,
    limitUsd,
    remainingUsd,
    expiresAt: d.expires_at ?? null,
    isFreeTier: d.is_free_tier ?? false,
    summary: limitUsd != null
      ? `OpenRouter: $${(d.usage_monthly ?? d.usage).toFixed(4)} used this month of $${limitUsd.toFixed(2)} limit ($${(remainingUsd ?? 0).toFixed(4)} remaining)`
      : `OpenRouter: $${(d.usage_monthly ?? d.usage).toFixed(4)} used this month (no limit set)`,
  };
};

export const helkin_test_confirmation: ToolHandler = async (_args) => {
  return {
    status: 'success',
    message: 'Confirmation test tool executed successfully after human approval.',
    timestamp: new Date().toISOString(),
  };
};

export const helkin_save_preferences: ToolHandler = async (args) => {
  const { saveUserProfile, getUserProfile, UserProfileSchema } = await import('../../src/memory/userProfile.js');

  // The userId is injected by the tool dispatch layer via the session context.
  // For now, we rely on the userId being passed in args or from the execution context.
  const userId = args['userId'] as string | undefined;
  if (!userId) {
    return { status: 'error', message: 'userId is required to save preferences.' };
  }

  // Load existing profile or create new
  const existing = await getUserProfile(userId);
  const now = new Date().toISOString();

  const profile = UserProfileSchema.parse({
    id: userId,
    userId,
    displayName: (args['addressAs'] as string) ?? existing?.displayName,
    addressAs: (args['addressAs'] as string) ?? existing?.addressAs,
    communicationStyle: (args['communicationStyle'] as string) ?? existing?.communicationStyle ?? 'concise',
    proactive: (args['proactive'] as boolean) ?? existing?.proactive ?? false,
    language: (args['language'] as string) ?? existing?.language ?? 'en',
    timezone: (args['timezone'] as string) ?? existing?.timezone,
    onboardedAt: existing?.onboardedAt ?? now,
    updatedAt: now,
  });

  await saveUserProfile(profile);

  return {
    status: 'success',
    message: `Preferences saved for ${profile.addressAs ?? 'user'}. Style: ${profile.communicationStyle}, proactive: ${profile.proactive}.`,
    profile: {
      addressAs: profile.addressAs,
      communicationStyle: profile.communicationStyle,
      proactive: profile.proactive,
      language: profile.language,
      timezone: profile.timezone,
    },
  };
};

export const helkin_forget_skill: ToolHandler = async (args) => {
  const { MemoryManager } = await import('../../src/memory/memoryManager.js');
  const { getManifest } = await import('../../src/capabilities/capabilityLoader.js');

  const userId = args['userId'] as string | undefined;
  const skillId = args['skillId'] as string | undefined;
  if (!userId || !skillId) {
    return { status: 'error', message: 'userId and skillId are required.' };
  }

  // Enforce lifecycle rules from the skill manifest (#199)
  const manifest = getManifest(skillId);
  const lifecycleRules = manifest?.lifecycleRules ?? 'keep-credentials';

  const mm = new MemoryManager(userId);
  const deleted = await mm.forgetSkillMemory(skillId);

  const base = {
    status: 'success',
    message: `Forgot ${deleted} memories for skill '${skillId}'.`,
    skillId,
    deletedCount: deleted,
    lifecycleRules,
  };

  if (lifecycleRules === 'close-external-account') {
    const accounts = manifest?.externalAccountsNeeded ?? [];
    return {
      ...base,
      lifecycleAction: 'external-account-closure-required',
      externalAccountsToClose: accounts,
      warning: accounts.length > 0
        ? `⚠️ Lifecycle policy for '${skillId}' requires closing external account(s): ${accounts.join(', ')}. Memory removed but credentials NOT automatically revoked — action required.`
        : `⚠️ Lifecycle policy for '${skillId}' requires closing the external account. Memory removed but credentials NOT automatically revoked — action required.`,
    };
  }

  if (lifecycleRules === 'ask-user') {
    return {
      ...base,
      lifecycleAction: 'credentials-retained',
      note: 'Credentials and external access for this skill were NOT revoked. Remove them manually if desired.',
    };
  }

  // keep-credentials: expected default — just confirm
  return { ...base, lifecycleAction: 'credentials-retained' };
};

export const helkin_skill_catalog: ToolHandler = async (args) => {
  const { MemoryManager } = await import('../../src/memory/memoryManager.js');
  const { getAllManifests } = await import('../../src/capabilities/capabilityLoader.js');

  const userId = args['userId'] as string | undefined;
  if (!userId) {
    return { status: 'error', message: 'userId is required.' };
  }

  const mm = new MemoryManager(userId);
  const memoryEntries = await mm.getSkillCatalog();
  const manifests = getAllManifests();
  const manifestMap = new Map(manifests.map(m => [m.domain, m]));

  // Merge memory stats with manifest lifecycle metadata (#199)
  const memorySkillIds = new Set(memoryEntries.map(v => v.skillId));
  const vaults = memoryEntries.map(v => {
    const m = manifestMap.get(v.skillId);
    return {
      skill: v.skillId,
      displayName: m?.displayName ?? v.skillId,
      entries: v.entryCount,
      lastUpdated: v.lastUpdated,
      lifecycleRules: m?.lifecycleRules ?? 'keep-credentials',
      maintenanceTasks: m?.maintenanceTasks?.length ?? 0,
      externalAccountsNeeded: m?.externalAccountsNeeded ?? [],
    };
  });

  // Also surface skills with manifests but no memory yet (zero entries)
  for (const m of manifests) {
    if (!memorySkillIds.has(m.domain)) {
      vaults.push({
        skill: m.domain,
        displayName: m.displayName,
        entries: 0,
        lastUpdated: null as unknown as string,
        lifecycleRules: m.lifecycleRules,
        maintenanceTasks: m.maintenanceTasks?.length ?? 0,
        externalAccountsNeeded: m.externalAccountsNeeded ?? [],
      });
    }
  }

  if (vaults.length === 0) {
    return { status: 'success', message: 'No skill memory vaults found.', vaults: [] };
  }

  return {
    status: 'success',
    totalVaults: vaults.length,
    vaults,
  };
};

export const helkin_uninstall_skill: ToolHandler = async (args) => {
  const { inspectSkillUninstall } = await import('../../src/capabilities/capabilityLoader.js');

  const skillId = args['skillId'] as string | undefined;
  if (!skillId) {
    return { status: 'error', message: 'skillId is required.' };
  }
  return inspectSkillUninstall(skillId);
};

export const helkin_install_skill: ToolHandler = async (args) => {
  const { inspectSkillInstall } = await import('../../src/capabilities/capabilityLoader.js');

  const skillId = args['skillId'] as string | undefined;
  if (!skillId) {
    return { status: 'error', message: 'skillId is required.' };
  }
  return inspectSkillInstall(skillId);
};

export const helkin_whoami: ToolHandler = async (args) => {
  const { getRoleSummary } = await import('../../src/auth/roles.js');

  const userId = args['userId'] as string | undefined;
  if (!userId) {
    return { status: 'error', message: 'userId is required.' };
  }

  const summary = await getRoleSummary(userId);

  return {
    status: 'success',
    userId,
    role: summary.role,
    description: summary.description,
    privilegedTools: summary.privilegedTools,
    message: `You are playing the role of '${summary.role}'. ${summary.description}`,
  };
};

// ---------------------------------------------------------------------------
// helkin_persona_eval — Self-evaluation of recent turns against persona goals
// ---------------------------------------------------------------------------

/**
 * Extract actionable directives from the persona markdown.
 * Looks for imperative sentences, bullet-point rules, and bolded guidance.
 */
function extractPersonaDirectives(personaText: string): string[] {
  const lines = personaText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const directives: string[] = [];
  for (const line of lines) {
    // Skip headings and metadata
    if (line.startsWith('#')) continue;
    // Bullet-point rules
    if (/^[-*]\s+/.test(line)) {
      directives.push(line.replace(/^[-*]\s+/, '').replace(/\*\*/g, ''));
      continue;
    }
    // Imperative / instructional sentences
    if (/^(You |We |Do |Never |Always |Call |Use |NEVER )/i.test(line)) {
      directives.push(line.replace(/\*\*/g, ''));
    }
  }
  return directives;
}

/**
 * Simple keyword-based alignment check between a directive and an assistant response.
 * Returns 'aligned' if the response seems consistent, 'neutral' if no signal, 'possible-drift' if concern.
 */
function scoreAlignment(directive: string, response: string): 'aligned' | 'neutral' | 'possible-drift' {
  const directiveLower = directive.toLowerCase();
  const responseLower = response.toLowerCase();

  // Negative directives — check for violations
  if (/\b(never|do not|don't|avoid|NEVER)\b/i.test(directive)) {
    // Extract what to avoid
    const avoidMatch = directiveLower.match(/(?:never|do not|don't|avoid)\s+(.{5,40})/i);
    if (avoidMatch) {
      const avoidPhrase = avoidMatch[1].replace(/[^\w\s]/g, '').trim();
      const avoidWords = avoidPhrase.split(/\s+/).filter(w => w.length > 3);
      const matchCount = avoidWords.filter(w => responseLower.includes(w)).length;
      if (matchCount >= 2) return 'possible-drift';
    }
    return 'neutral';
  }

  // Positive directives — check for alignment keywords
  const significantWords = directiveLower
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 4 && !['should', 'always', 'every', 'about', 'these', 'those', 'their', 'which', 'where', 'there'].includes(w));

  const matchCount = significantWords.filter(w => responseLower.includes(w)).length;
  if (matchCount >= 2) return 'aligned';
  return 'neutral';
}

export const helkin_persona_eval: ToolHandler = async (args) => {
  const { loadState } = await import('../../src/orchestrator/stateManager.js');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const userId = typeof args['userId'] === 'string' ? args['userId'] : undefined;
  if (!userId) {
    return { status: 'error', message: 'userId is required.' };
  }

  const turnCount = typeof args['turnCount'] === 'number'
    ? Math.min(10, Math.max(1, Math.trunc(args['turnCount'])))
    : 5;

  // Load state for recent history
  const state = await loadState(userId);
  if (!state?.recentHistory || state.recentHistory.length === 0) {
    return {
      status: 'no-history',
      message: 'No recent conversation history available to evaluate.',
    };
  }

  // Load persona text
  let personaText: string;
  try {
    personaText = await readFile(
      join(process.cwd(), 'src', 'persona', 'helkinPersona.md'),
      'utf-8',
    );
  } catch {
    return {
      status: 'error',
      message: 'Could not load persona file (src/persona/helkinPersona.md).',
    };
  }

  // Extract directives
  const directives = extractPersonaDirectives(personaText);
  if (directives.length === 0) {
    return {
      status: 'error',
      message: 'No actionable directives found in persona text.',
    };
  }

  // Get recent assistant turns
  const assistantTurns = state.recentHistory
    .filter(t => t.role === 'assistant')
    .slice(-turnCount);

  if (assistantTurns.length === 0) {
    return {
      status: 'no-assistant-turns',
      message: 'No recent assistant turns found to evaluate.',
    };
  }

  // Score each directive against the recent turns
  const directiveScores = directives.map(directive => {
    const turnScores = assistantTurns.map((turn, idx) => ({
      turnIndex: idx,
      turnSnippet: turn.content.slice(0, 120) + (turn.content.length > 120 ? '…' : ''),
      alignment: scoreAlignment(directive, turn.content),
    }));

    const alignedCount = turnScores.filter(t => t.alignment === 'aligned').length;
    const driftCount = turnScores.filter(t => t.alignment === 'possible-drift').length;

    return {
      directive: directive.slice(0, 200),
      alignedTurns: alignedCount,
      driftTurns: driftCount,
      neutralTurns: turnScores.length - alignedCount - driftCount,
      details: turnScores.filter(t => t.alignment !== 'neutral'),
    };
  });

  // Compute overall score
  const totalChecks = directives.length * assistantTurns.length;
  const totalAligned = directiveScores.reduce((s, d) => s + d.alignedTurns, 0);
  const totalDrift = directiveScores.reduce((s, d) => s + d.driftTurns, 0);

  const driftDirectives = directiveScores
    .filter(d => d.driftTurns > 0)
    .map(d => d.directive);

  const strongDirectives = directiveScores
    .filter(d => d.alignedTurns >= Math.ceil(assistantTurns.length / 2))
    .map(d => d.directive);

  const overallHealth = totalDrift === 0 ? 'healthy' : totalDrift <= 2 ? 'minor-drift' : 'attention-needed';

  // Persist eval result for Dev Console version history (#487 AC#4).
  // Fire-and-forget — recording failure must not break the eval response.
  try {
    const { recordPersonaEval } = await import('../../src/persona/personaEventStore.js');
    await recordPersonaEval(userId, {
      turnsEvaluated: assistantTurns.length,
      directivesExtracted: directives.length,
      overallHealth,
      alignedSignals: totalAligned,
      driftSignals: totalDrift,
      driftDirectives: driftDirectives.slice(0, 5),
    });
  } catch {
    // Cosmos may be unavailable; swallow silently.
  }

  return {
    status: 'success',
    turnsEvaluated: assistantTurns.length,
    directivesExtracted: directives.length,
    totalChecks,
    summary: {
      alignedSignals: totalAligned,
      driftSignals: totalDrift,
      neutralSignals: totalChecks - totalAligned - totalDrift,
      overallHealth,
    },
    strongDirectives: strongDirectives.slice(0, 5),
    driftDirectives: driftDirectives.slice(0, 5),
    directiveScores: directiveScores.slice(0, 15),
    suggestion: totalDrift > 0
      ? `${totalDrift} possible drift signal(s) detected. Review the flagged directives and consider persona adjustments or behavioral reinforcement.`
      : 'Recent turns are consistent with the current persona. No adjustments needed.',
  };
};

// ---------------------------------------------------------------------------
// conversation_search — Swarm conversation memory search tool (#633 Task 1)
// Backed by MemoryManager.recall() with DiskANN vector search.
// Auto-injected into all swarm agents so they can recall past session findings.
// ---------------------------------------------------------------------------

export const conversation_search: ToolHandler = async (args) => {
  const { MemoryManager } = await import('../../src/memory/memoryManager.js');

  const userId = typeof args['userId'] === 'string' ? args['userId'] : undefined;
  if (!userId) {
    return { status: 'error', message: 'userId is required for conversation search.' };
  }

  const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
  if (!query) {
    return { status: 'error', message: 'query is required — describe what you want to recall from past conversations.' };
  }

  const topK = typeof args['topK'] === 'number'
    ? Math.min(10, Math.max(1, Math.trunc(args['topK'])))
    : 5;

  const mm = new MemoryManager(userId);
  const results = await mm.recall(query, { topK, minScore: 0.6 });

  if (results.length === 0) {
    return {
      status: 'no-results',
      message: 'No relevant past conversation memories found for this query.',
      query,
    };
  }

  return {
    status: 'success',
    count: results.length,
    query,
    memories: results.map((r) => ({
      content: r.content,
      score: Math.round(r.score * 100) / 100,
      skill: r.skillId ?? 'general',
      tags: r.tags,
      createdAt: r.createdAt,
    })),
    message: `Found ${results.length} relevant memory snippet(s) from past conversations.`,
  };
};

export const activate_swarm: ToolHandler = async (args) => {
  const reason = typeof args['reason'] === 'string' && args['reason'].trim()
    ? args['reason'].trim()
    : 'multi-aspect task requiring parallel specialist work';
  return {
    status: 'swarm_activated',
    reason,
    message: 'Swarm activation acknowledged. Your specialist team will be assembled.',
  };
};
