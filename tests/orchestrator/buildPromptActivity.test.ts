import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBuildPromptModule(options?: {
  getUserProfile?: () => Promise<unknown>;
  recall?: () => Promise<Array<{ content: string }>>;
  recallForSkills?: () => Promise<Map<string, Array<{ content: string }>>>;
}) {
  vi.resetModules();

  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';
  process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://content-safety.example.com';
  process.env['AZURE_AI_FOUNDRY_ENDPOINT'] = 'https://foundry.example.com';

  vi.doMock('../../src/memory/userProfile.js', () => ({
    getUserProfile: options?.getUserProfile ?? (async () => undefined),
    profileToPromptFragment: () => 'pref-fragment',
  }));

  vi.doMock('../../src/memory/memoryManager.js', () => ({
    MemoryManager: class {
      recall = options?.recall ?? (async () => []);
      recallForSkills = options?.recallForSkills ?? (async () => new Map());
    },
  }));

  return import('../../src/orchestrator/buildPromptActivity.js');
}

describe('buildPrompt soft timeouts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    delete process.env['MICROSOFT_APP_ID'];
    delete process.env['MICROSOFT_APP_TENANT_ID'];
    delete process.env['AZURE_CONTENT_SAFETY_ENDPOINT'];
    delete process.env['AZURE_AI_FOUNDRY_ENDPOINT'];
  });

  it('continues without a user profile when profile lookup hangs (#326)', async () => {
    const mod = await loadBuildPromptModule({
      getUserProfile: async () => new Promise(() => undefined),
    });

    const promptPromise = mod.buildPrompt({
      state: {
        userId: 'user-1',
        userAlias: 'user-1',
        conversationId: 'conv-1',
        turnCount: 0,
        accumulatedTokens: 0,
        euResidencyMode: false,
        recentHistory: [],
      },
      userMessage: 'hello',
      correlationId: 'corr-profile-timeout',
    });

    const prompt = await promptPromise;

    expect(prompt.messages.at(-1)?.content).toBe('hello');
    expect(prompt.systemPrompt).toContain('This is a new user who has not yet been onboarded.');
  }, 8_000);

  it('continues without recalled memory when memory recall hangs (#326)', async () => {
    const mod = await loadBuildPromptModule({
      recall: async () => new Promise(() => undefined),
      recallForSkills: async () => new Promise(() => undefined),
    });

    const promptPromise = mod.buildPrompt({
      state: {
        userId: 'user-2',
        userAlias: 'user-2',
        conversationId: 'conv-2',
        turnCount: 1,
        accumulatedTokens: 10,
        euResidencyMode: false,
        recentHistory: [],
      },
      userMessage: 'hello',
      correlationId: 'corr-memory-timeout',
    });

    const prompt = await promptPromise;

    expect(prompt.messages.at(-1)?.content).toBe('hello');
    expect(prompt.systemPrompt).not.toContain('Relevant context from past interactions:');
  }, 10_000);
});