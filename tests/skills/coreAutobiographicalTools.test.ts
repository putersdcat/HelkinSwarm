import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('core autobiographical tools', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T13:30:45.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('helkin_current_datetime returns grounded runtime date/time', async () => {
    vi.doMock('../../src/memory/userProfile.js', () => ({
      getUserProfile: async () => ({ timezone: 'UTC' }),
    }));

    const { helkin_current_datetime } = await import('../../skills/core/handlers.js');
    const result = await helkin_current_datetime({ userId: 'user-1' }) as {
      status: string;
      timezone: string;
      date: string;
      weekday: string;
      time: string;
      message: string;
    };

    expect(result.status).toBe('success');
    expect(result.timezone).toBe('UTC');
    expect(result.date).toBe('Thursday, April 9, 2026');
    expect(result.weekday).toBe('Thursday');
    expect(result.time).toContain('1:30:45 PM');
    expect(result.message).toContain('Today is Thursday, April 9, 2026.');
  });

  it('helkin_recent_requests returns the most recent user prompts from session state', async () => {
    vi.doMock('../../src/orchestrator/stateManager.js', () => ({
      loadState: async () => ({
        recentHistory: [
          { role: 'user', content: 'Hey buddy' },
          { role: 'assistant', content: 'Hello there' },
          { role: 'user', content: 'What is your purpose?' },
          { role: 'assistant', content: 'To help.' },
          { role: 'user', content: 'What day is it?' },
        ],
      }),
    }));

    const { helkin_recent_requests } = await import('../../skills/core/handlers.js');
    const result = await helkin_recent_requests({ userId: 'user-1', count: 2 }) as {
      status: string;
      count: number;
      requests: string[];
      message: string;
    };

    expect(result.status).toBe('success');
    expect(result.count).toBe(2);
    expect(result.requests).toEqual(['What is your purpose?', 'What day is it?']);
    expect(result.message).toContain('"What is your purpose?"');
    expect(result.message).toContain('"What day is it?"');
  });
});