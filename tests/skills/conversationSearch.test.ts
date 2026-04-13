// Tests for conversation_search tool — #633 Task 1.
// Validates the tool handler contract and worker auto-injection.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock MemoryManager
// ---------------------------------------------------------------------------
const { mockRecall } = vi.hoisted(() => {
  const mockRecall = vi.fn().mockResolvedValue([]);
  return { mockRecall };
});

vi.mock('../../src/memory/memoryManager.js', () => ({
  MemoryManager: class MockMemoryManager {
    constructor(_userId: string) {}
    recall = mockRecall;
  },
}));

import { conversation_search } from '../../skills/core/handlers.js';

describe('conversation_search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecall.mockResolvedValue([]);
  });

  it('returns error when userId is missing', async () => {
    const result = await conversation_search({ query: 'test' });
    expect(result).toMatchObject({
      status: 'error',
      message: expect.stringContaining('userId'),
    });
  });

  it('returns error when query is empty', async () => {
    const result = await conversation_search({ userId: 'u1', query: '' });
    expect(result).toMatchObject({
      status: 'error',
      message: expect.stringContaining('query'),
    });
  });

  it('returns no-results when recall returns empty', async () => {
    mockRecall.mockResolvedValueOnce([]);
    const result = await conversation_search({ userId: 'u1', query: 'budget analysis' });
    expect(result).toMatchObject({
      status: 'no-results',
      query: 'budget analysis',
    });
  });

  it('returns memories from recall results', async () => {
    mockRecall.mockResolvedValueOnce([
      { content: 'Budget was $5000', score: 0.92, skillId: 'budget', tags: ['finance'], createdAt: '2026-04-10T00:00:00Z' },
      { content: 'Q1 revenue was $12k', score: 0.85, tags: ['finance'], createdAt: '2026-04-09T00:00:00Z' },
    ]);

    const result = await conversation_search({ userId: 'u1', query: 'budget' }) as Record<string, unknown>;
    expect(result['status']).toBe('success');
    expect(result['count']).toBe(2);

    const memories = result['memories'] as Array<Record<string, unknown>>;
    expect(memories[0]).toMatchObject({
      content: 'Budget was $5000',
      score: 0.92,
      skill: 'budget',
    });
    expect(memories[1]).toMatchObject({
      content: 'Q1 revenue was $12k',
      skill: 'general',
    });
  });

  it('passes topK to recall options', async () => {
    mockRecall.mockResolvedValueOnce([]);
    await conversation_search({ userId: 'u1', query: 'test', topK: 3 });

    expect(mockRecall).toHaveBeenCalledWith('test', expect.objectContaining({
      topK: 3,
      minScore: 0.6,
    }));
  });

  it('clamps topK between 1 and 10', async () => {
    mockRecall.mockResolvedValue([]);

    await conversation_search({ userId: 'u1', query: 'test', topK: 50 });
    expect(mockRecall).toHaveBeenCalledWith('test', expect.objectContaining({ topK: 10 }));

    await conversation_search({ userId: 'u1', query: 'test', topK: 0 });
    expect(mockRecall).toHaveBeenCalledWith('test', expect.objectContaining({ topK: 1 }));
  });
});
