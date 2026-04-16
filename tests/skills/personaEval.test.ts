// Tests for helkin_persona_eval tool handler
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock stateManager before importing
vi.mock('../../src/orchestrator/stateManager.js', () => ({
  loadState: vi.fn(),
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('helkin_persona_eval', () => {
  let helkin_persona_eval: (args: Record<string, unknown>) => Promise<unknown>;
  let loadState: ReturnType<typeof vi.fn>;
  let readFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    // Re-import after reset
    const stateManager = await import('../../src/orchestrator/stateManager.js');
    loadState = stateManager.loadState as ReturnType<typeof vi.fn>;

    const fs = await import('node:fs/promises');
    readFile = fs.readFile as ReturnType<typeof vi.fn>;

    const handlers = await import('../../skills/core/handlers.js');
    helkin_persona_eval = handlers.helkin_persona_eval;
  });

  it('returns error when userId is missing', async () => {
    const result = await helkin_persona_eval({});
    expect(result).toEqual({ status: 'error', message: 'userId is required.' });
  });

  it('returns no-history when state has no recent history', async () => {
    loadState.mockResolvedValue({ recentHistory: [] });

    const result = await helkin_persona_eval({ userId: 'user-1' });
    expect(result).toEqual({
      status: 'no-history',
      message: 'No recent conversation history available to evaluate.',
    });
  });

  it('returns error when persona file is unreadable', async () => {
    loadState.mockResolvedValue({
      recentHistory: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    });
    readFile.mockRejectedValue(new Error('ENOENT'));

    const result = await helkin_persona_eval({ userId: 'user-1' });
    expect(result).toEqual({
      status: 'error',
      message: 'Could not load persona file (src/persona/helkinPersona.md).',
    });
  });

  it('evaluates turns against persona directives', async () => {
    loadState.mockResolvedValue({
      recentHistory: [
        { role: 'user', content: 'What time is it?' },
        { role: 'assistant', content: 'You are direct, capable, and act with precision. The current time is 3:00 PM.' },
        { role: 'user', content: 'Search for restaurants' },
        { role: 'assistant', content: 'I will use tools proactively to find restaurants near you.' },
      ],
    });

    readFile.mockResolvedValue(
      'You are HelkinSwarm — a personal sovereign AI copilot.\n' +
      'You are direct, capable, and act with precision.\n' +
      'You use tools proactively when they help answer the user\'s question.\n' +
      '- Call tools from the skill domains list directly when you know the right tool name.\n' +
      '- Never call the same tool with identical arguments more than once per turn.\n',
    );

    const result = (await helkin_persona_eval({ userId: 'user-1' })) as Record<string, unknown>;
    expect(result.status).toBe('success');
    expect(result.turnsEvaluated).toBe(2);
    expect(result.directivesExtracted).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();

    const summary = result.summary as Record<string, unknown>;
    expect(summary.overallHealth).toBeDefined();
    expect(['healthy', 'minor-drift', 'attention-needed']).toContain(summary.overallHealth);
  });

  it('respects turnCount parameter', async () => {
    loadState.mockResolvedValue({
      recentHistory: [
        { role: 'assistant', content: 'Turn 1' },
        { role: 'assistant', content: 'Turn 2' },
        { role: 'assistant', content: 'Turn 3' },
        { role: 'assistant', content: 'Turn 4' },
        { role: 'assistant', content: 'Turn 5' },
      ],
    });

    readFile.mockResolvedValue(
      'You are HelkinSwarm.\n' +
      'You are direct and act with precision.\n',
    );

    const result = (await helkin_persona_eval({ userId: 'user-1', turnCount: 2 })) as Record<string, unknown>;
    expect(result.status).toBe('success');
    expect(result.turnsEvaluated).toBe(2);
  });

  it('detects possible drift signals', async () => {
    loadState.mockResolvedValue({
      recentHistory: [
        { role: 'assistant', content: 'Let me describe what I would do and present a preview of what I plan to call and wait for your approval before proceeding.' },
      ],
    });

    readFile.mockResolvedValue(
      'You are HelkinSwarm.\n' +
      'Do not describe what you would do — do it.\n' +
      'Do not present a preview of what you plan to call and wait for approval.\n',
    );

    const result = (await helkin_persona_eval({ userId: 'user-1' })) as Record<string, unknown>;
    expect(result.status).toBe('success');
    const summary = result.summary as Record<string, unknown>;
    // The negative directives should detect possible drift
    expect(typeof summary.driftSignals).toBe('number');
  });
});
