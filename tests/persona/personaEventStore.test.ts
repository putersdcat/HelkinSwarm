// Tests for persona event store — #487 AC#4.
// Validates schema shapes, store/read contract, and Dev Console integration wiring.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Cosmos container
// ---------------------------------------------------------------------------
const { mockCreate, mockFetchAll, mockQuery } = vi.hoisted(() => {
  const mockCreate = vi.fn().mockResolvedValue({ resource: {} });
  const mockFetchAll = vi.fn().mockResolvedValue({ resources: [] });
  const mockQuery = vi.fn().mockReturnValue({ fetchAll: mockFetchAll });
  return { mockCreate, mockFetchAll, mockQuery };
});

vi.mock('../../src/memory/cosmosClient.js', () => ({
  getContainer: vi.fn().mockReturnValue({
    items: {
      create: mockCreate,
      query: mockQuery,
    },
  }),
}));

import {
  recordPersonaReload,
  recordPersonaEval,
  getRecentPersonaEvents,
} from '../../src/persona/personaEventStore.js';

describe('personaEventStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAll.mockResolvedValue({ resources: [] });
  });

  // -------------------------------------------------------------------------
  // recordPersonaReload
  // -------------------------------------------------------------------------
  describe('recordPersonaReload', () => {
    it('writes an approved reload event document', async () => {
      await recordPersonaReload('user-1', 'approved');

      expect(mockCreate).toHaveBeenCalledOnce();
      const doc = mockCreate.mock.calls[0][0];
      expect(doc.type).toBe('persona-reload');
      expect(doc.action).toBe('approved');
      expect(doc.userId).toBe('user-1');
      expect(doc.id).toMatch(/^persona-reload-/);
      expect(doc.timestamp).toBeTruthy();
    });

    it('writes a denied reload event document', async () => {
      await recordPersonaReload('user-2', 'denied');

      const doc = mockCreate.mock.calls[0][0];
      expect(doc.action).toBe('denied');
      expect(doc.userId).toBe('user-2');
    });
  });

  // -------------------------------------------------------------------------
  // recordPersonaEval
  // -------------------------------------------------------------------------
  describe('recordPersonaEval', () => {
    it('writes an eval event document with summary fields', async () => {
      await recordPersonaEval('user-1', {
        turnsEvaluated: 5,
        directivesExtracted: 12,
        overallHealth: 'healthy',
        alignedSignals: 10,
        driftSignals: 0,
        driftDirectives: [],
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      const doc = mockCreate.mock.calls[0][0];
      expect(doc.type).toBe('persona-eval');
      expect(doc.userId).toBe('user-1');
      expect(doc.turnsEvaluated).toBe(5);
      expect(doc.directivesExtracted).toBe(12);
      expect(doc.overallHealth).toBe('healthy');
      expect(doc.alignedSignals).toBe(10);
      expect(doc.driftSignals).toBe(0);
      expect(doc.driftDirectives).toEqual([]);
      expect(doc.id).toMatch(/^persona-eval-/);
      expect(doc.timestamp).toBeTruthy();
    });

    it('captures drift directives in eval events', async () => {
      await recordPersonaEval('user-1', {
        turnsEvaluated: 3,
        directivesExtracted: 8,
        overallHealth: 'attention-needed',
        alignedSignals: 2,
        driftSignals: 4,
        driftDirectives: ['Never do X', 'Always do Y'],
      });

      const doc = mockCreate.mock.calls[0][0];
      expect(doc.driftSignals).toBe(4);
      expect(doc.driftDirectives).toEqual(['Never do X', 'Always do Y']);
    });
  });

  // -------------------------------------------------------------------------
  // getRecentPersonaEvents
  // -------------------------------------------------------------------------
  describe('getRecentPersonaEvents', () => {
    it('queries for recent persona events by userId', async () => {
      const fakeEvents = [
        { id: 'pe-1', type: 'persona-reload', action: 'approved', userId: 'user-1', timestamp: '2026-04-13T01:00:00Z' },
        { id: 'pe-2', type: 'persona-eval', userId: 'user-1', turnsEvaluated: 5, overallHealth: 'healthy', timestamp: '2026-04-13T00:30:00Z' },
      ];
      mockFetchAll.mockResolvedValueOnce({ resources: fakeEvents });

      const events = await getRecentPersonaEvents('user-1');

      expect(mockQuery).toHaveBeenCalledOnce();
      const queryArg = mockQuery.mock.calls[0][0];
      expect(queryArg.query).toContain('persona-reload');
      expect(queryArg.query).toContain('persona-eval');
      expect(queryArg.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: '@userId', value: 'user-1' }),
        ]),
      );
      expect(events).toEqual(fakeEvents);
    });

    it('respects the limit parameter', async () => {
      mockFetchAll.mockResolvedValueOnce({ resources: [] });
      await getRecentPersonaEvents('user-1', 5);

      const queryArg = mockQuery.mock.calls[0][0];
      expect(queryArg.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: '@limit', value: 5 }),
        ]),
      );
    });

    it('returns empty array when no events found', async () => {
      mockFetchAll.mockResolvedValueOnce({ resources: [] });
      const events = await getRecentPersonaEvents('user-no-events');
      expect(events).toEqual([]);
    });
  });
});
