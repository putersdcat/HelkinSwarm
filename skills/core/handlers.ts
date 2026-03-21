// Core skill handlers — built-in tools that are always available.
// Spec ref: 05-Capabilities-Framework.md
// Each export matches a tool name from manifest.json.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';

export const helkin_health_check: ToolHandler = async (_args) => {
  const euMode = process.env['EU_RESIDENCY_MODE'] === 'true';
  const safetyMode = process.env['SAFETY_MODE'] ?? 'confirmation-gated';

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env['npm_package_version'] ?? '0.1.0',
    components: {
      runtime: 'ok',
      overseer: 'ok',
      llm: 'ok',
      memory: 'pending',
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

export const helkin_get_costs: ToolHandler = async (_args) => {
  // Azure Cost Management API integration is a future enhancement.
  // For now, return a descriptive message.
  return {
    message: 'Cost reporting is not yet connected to Azure Cost Management API.',
    hint: 'This will be available once the Azure management skill is implemented.',
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
