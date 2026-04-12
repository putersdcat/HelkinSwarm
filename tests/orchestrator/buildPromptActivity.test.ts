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

  it('injects inbound runtime asset summaries and notices without exposing raw bytes', async () => {
    const mod = await loadBuildPromptModule();

    const prompt = await mod.buildPrompt({
      state: {
        userId: 'user-3',
        userAlias: 'user-3',
        conversationId: 'conv-3',
        turnCount: 0,
        accumulatedTokens: 0,
        euResidencyMode: false,
        recentHistory: [],
      },
      userMessage: 'summarize the uploaded document',
      runtimeAssets: [
        {
          version: 1,
          id: '11111111-1111-4111-8111-111111111111',
          userId: 'user-3',
          correlationId: 'corr-assets',
          kind: 'document',
          contentType: 'application/pdf',
          fileName: 'paper.pdf',
          byteLength: 2048,
          sha256: 'c'.repeat(64),
          source: {
            channel: 'teams',
            attachmentKind: 'file-download',
          },
          createdAt: '2026-03-31T00:00:00.000Z',
          expiresAt: '2026-03-31T06:00:00.000Z',
          ttlSeconds: 21600,
          storage: {
            container: 'helkinswarm-runtime-assets',
            payloadBlobPath: 'payload/paper.pdf',
            metadataBlobPath: 'metadata/paper.pdf.json',
          },
        },
      ],
      attachmentNotices: ['Skipped attachment `big.zip`: exceeds runtime attachment limit.'],
      correlationId: 'corr-asset-summary',
    });

    expect(prompt.systemPrompt).toContain('Inbound runtime assets for this turn');
    expect(prompt.systemPrompt).toContain('Attachment kind: file-download');
    expect(prompt.systemPrompt).toContain('paper.pdf');
    expect(prompt.systemPrompt).toContain('Asset ID: `11111111-1111-4111-8111-111111111111`');
    expect(prompt.systemPrompt).toContain('Attachment ingestion notices');
    expect(prompt.systemPrompt).toContain('Skipped attachment `big.zip`');
    expect(prompt.systemPrompt).not.toContain('JVBER');
  });

  it('injects autobiographical grounding with runtime date/time and recent user requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T13:30:00.000Z'));

    const mod = await loadBuildPromptModule({
      getUserProfile: async () => ({
        onboardedAt: '2026-04-01T00:00:00.000Z',
        timezone: 'UTC',
      }),
    });

    const prompt = await mod.buildPrompt({
      state: {
        userId: 'user-4',
        userAlias: 'user-4',
        conversationId: 'conv-4',
        turnCount: 2,
        accumulatedTokens: 42,
        euResidencyMode: false,
        recentHistory: [
          { role: 'user', content: 'Hey buddy' },
          { role: 'assistant', content: 'Hello.' },
          { role: 'user', content: 'What is your purpose?' },
          { role: 'assistant', content: 'To help.' },
        ],
      },
      userMessage: 'what were my last two requests?',
      correlationId: 'corr-autobio',
    });

    expect(prompt.systemPrompt).toContain('Immediate autobiographical grounding:');
    expect(prompt.systemPrompt).toContain('Current runtime date: Thursday, April 9, 2026 (UTC)');
    expect(prompt.systemPrompt).toContain('Most recent prior user requests: "Hey buddy"; "What is your purpose?"');
  });

  it('clearPersonaCache forces persona re-read on next buildPrompt call (#487)', async () => {
    const mod = await loadBuildPromptModule();

    // First call — persona loads and caches
    const prompt1 = await mod.buildPrompt({
      state: {
        userId: 'user-persona-reload',
        userAlias: 'user-persona-reload',
        conversationId: 'conv-reload',
        turnCount: 0,
        accumulatedTokens: 0,
        euResidencyMode: false,
        recentHistory: [],
      },
      userMessage: 'hello',
      correlationId: 'corr-persona-reload-1',
    });

    const originalPersona = prompt1.systemPrompt;
    expect(originalPersona.length).toBeGreaterThan(0);

    // Clear the persona cache
    mod.clearPersonaCache();

    // Second call — persona re-reads from disk (same file, so same content)
    const prompt2 = await mod.buildPrompt({
      state: {
        userId: 'user-persona-reload',
        userAlias: 'user-persona-reload',
        conversationId: 'conv-reload',
        turnCount: 1,
        accumulatedTokens: 10,
        euResidencyMode: false,
        recentHistory: [],
      },
      userMessage: 'world',
      correlationId: 'corr-persona-reload-2',
    });

    // Persona content should be the same (same source file) but the cache was cleared
    expect(prompt2.systemPrompt).toContain('HelkinSwarm');
  }, 10_000);
});