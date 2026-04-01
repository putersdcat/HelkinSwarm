// Core skill handlers — built-in tools that are always available.
// Spec ref: 05-Capabilities-Framework.md
// Each export matches a tool name from manifest.json.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';

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

  const tools = toolRegistry.getAll();
  const domains = new Map<string, { toolCount: number; tools: string[] }>();

  for (const tool of tools) {
    const domain = tool.name.split('_')[0] ?? 'unknown';
    const entry = domains.get(domain) ?? { toolCount: 0, tools: [] };
    entry.toolCount++;
    entry.tools.push(tool.name);
    domains.set(domain, entry);
  }

  return {
    totalTools: tools.length,
    domains: Object.fromEntries(domains),
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

    trackEvent({
      name: 'DiscoveryQueryExecuted',
      correlationId,
      userId,
      properties: {
        query,
        skillCount: result.skills.length,
        toolCount: result.tools.length,
        selectedTools: result.tools.map((tool) => tool.id).join(','),
      },
    });

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
          recommendedEntryTools: skill?.recommendedEntryTools ?? [],
          score: hit.score,
          matchReasons: hit.matchReasons,
        };
      }),
      capabilityGroups: result.capabilityGroups.map((hit) => {
        const group = getDiscoveryCapabilityGroup(hit.id);
        return {
          id: hit.id,
          domain: hit.domain,
          displayName: group?.displayName ?? hit.id,
          shortDescription: group?.shortDescription ?? '',
          toolCount: group?.toolCount ?? 0,
          toolNames: group?.toolNames ?? [],
          upstreamNamespace: group?.upstreamNamespace ?? null,
          score: hit.score,
          matchReasons: hit.matchReasons,
        };
      }),
      tools: result.tools.map((hit) => {
        const tool = getDiscoveryTool(hit.id);
        return {
          name: hit.id,
          domain: hit.domain,
          description: tool?.description ?? '',
          risk: tool?.risk ?? 'low',
          allowedModelLane: tool?.allowedModelLane ?? 'any',
          safetyCompatible: tool ? toolRegistry.isAllowedBySafetyMode(tool.name) : false,
          score: hit.score,
          matchReasons: hit.matchReasons,
        };
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
