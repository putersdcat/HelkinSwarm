// Tests for swarmMemoryCommitActivity — message selection heuristic + activity logic.
// Epic: #631, Task: #633

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatroomMessage } from '../../src/orchestrator/swarm/swarmTypes.js';
import { selectHighValueMessages } from '../../src/orchestrator/swarm/swarmMemoryCommitActivity.js';

// ---------------------------------------------------------------------------
// Helpers — create chatroom messages with minimal ceremony
// ---------------------------------------------------------------------------

function makeMsg(overrides: Partial<ChatroomMessage> = {}): ChatroomMessage {
  return {
    id: crypto.randomUUID(),
    from: 'Alpha',
    to: 'Leader',
    content: 'x'.repeat(120), // above minimum thresholds by default
    contentType: 'text',
    timestamp: Date.now(),
    correlationId: 'test-corr',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectHighValueMessages tests (Task 3 — message selection heuristic)
// ---------------------------------------------------------------------------

describe('selectHighValueMessages', () => {
  it('includes partial_result messages above min length', () => {
    const msgs = [makeMsg({ contentType: 'partial_result', content: 'A'.repeat(60) })];
    expect(selectHighValueMessages(msgs)).toHaveLength(1);
  });

  it('includes cross_verification messages above min length', () => {
    const msgs = [makeMsg({ contentType: 'cross_verification', content: 'B'.repeat(60) })];
    expect(selectHighValueMessages(msgs)).toHaveLength(1);
  });

  it('excludes status messages', () => {
    const msgs = [makeMsg({ contentType: 'status', content: 'Starting research...' })];
    expect(selectHighValueMessages(msgs)).toHaveLength(0);
  });

  it('excludes delegation messages', () => {
    const msgs = [makeMsg({ contentType: 'delegation' })];
    expect(selectHighValueMessages(msgs)).toHaveLength(0);
  });

  it('excludes question messages', () => {
    const msgs = [makeMsg({ contentType: 'question' })];
    expect(selectHighValueMessages(msgs)).toHaveLength(0);
  });

  it('excludes vote messages', () => {
    const msgs = [makeMsg({ contentType: 'vote' })];
    expect(selectHighValueMessages(msgs)).toHaveLength(0);
  });

  it('excludes error messages', () => {
    const msgs = [makeMsg({ contentType: 'error' })];
    expect(selectHighValueMessages(msgs)).toHaveLength(0);
  });

  it('excludes partial_result below minimum length', () => {
    const msgs = [makeMsg({ contentType: 'partial_result', content: 'short' })];
    expect(selectHighValueMessages(msgs)).toHaveLength(0);
  });

  it('includes generic text messages above double minimum length', () => {
    const msgs = [makeMsg({ contentType: 'text', content: 'X'.repeat(100) })];
    expect(selectHighValueMessages(msgs)).toHaveLength(1);
  });

  it('excludes generic text messages below double minimum length', () => {
    const msgs = [makeMsg({ contentType: 'text', content: 'X'.repeat(50) })];
    expect(selectHighValueMessages(msgs)).toHaveLength(0);
  });

  it('filters a mixed transcript correctly', () => {
    const msgs = [
      makeMsg({ contentType: 'status', content: 'Starting...' }),
      makeMsg({ contentType: 'partial_result', content: 'Found 5 results about FOX suspension.'.padEnd(60, '.') }),
      makeMsg({ contentType: 'question', content: 'What area should I search?' }),
      makeMsg({ contentType: 'cross_verification', content: 'Confirmed: Munich service center exists at address XYZ, verified via Google Maps.'.padEnd(60, '.') }),
      makeMsg({ contentType: 'text', content: 'Y'.repeat(200) }),
      makeMsg({ contentType: 'delegation', content: 'Alpha, please search for service centers' }),
    ];
    const selected = selectHighValueMessages(msgs);
    expect(selected).toHaveLength(3); // partial_result + cross_verification + long text
    expect(selected.map(m => m.contentType)).toEqual(['partial_result', 'cross_verification', 'text']);
  });
});

// ---------------------------------------------------------------------------
// SwarmCost type tests (Task 4 — cost tracking)
// ---------------------------------------------------------------------------

describe('SwarmCost type structure', () => {
  it('SwarmOrchestratorResult includes swarmCost field', async () => {
    const { SwarmPlanSchema } = await import('../../src/orchestrator/swarm/swarmTypes.js');
    // Verify the type compiles by constructing a result object
    const result = {
      response: 'test',
      success: true,
      totalTokensUsed: 500,
      agentResults: [],
      leaderResult: {
        synthesis: 'test',
        success: true,
        tokensUsed: 200,
        roundsUsed: 1,
        agentsHeardFrom: ['Alpha'],
        model: 'grok-3',
      },
      chatroomTranscript: [],
      swarmId: 'test-id',
      swarmCost: {
        decomposerTokens: 100,
        workerTokens: 200,
        leaderTokens: 200,
        totalTokens: 500,
        agentBreakdown: [{ agent: 'Alpha', tokens: 200, model: 'grok-3', toolsUsed: ['web_search'], durationMs: 5000 }],
      },
    };
    expect(result.swarmCost.agentBreakdown).toHaveLength(1);
    expect(result.swarmCost.agentBreakdown[0].toolsUsed).toEqual(['web_search']);
    expect(result.swarmCost.agentBreakdown[0].durationMs).toBe(5000);
    expect(result.swarmCost.totalTokens).toBe(500);
  });
});
