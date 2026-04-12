// Tests for swarm types and eligibility scoring
// Epic: #631

import { describe, it, expect } from 'vitest';
import { isSwarmEligible, SwarmPlanSchema, ChatroomMessageSchema, SwarmAgentSchema } from '../../src/orchestrator/swarm/swarmTypes.js';

describe('isSwarmEligible', () => {
  it('returns false for simple greetings', () => {
    expect(isSwarmEligible('hello')).toBe(false);
    expect(isSwarmEligible('hi there')).toBe(false);
    expect(isSwarmEligible('good morning')).toBe(false);
  });

  it('returns false for simple questions', () => {
    expect(isSwarmEligible('what time is it?')).toBe(false);
    expect(isSwarmEligible('list my emails')).toBe(false);
  });

  it('returns true for multi-faceted research queries', () => {
    expect(isSwarmEligible(
      'Research the pros and cons of React vs Vue, and also compare their ecosystem and community support',
    )).toBe(true);
  });

  it('returns true for compound analysis with verification', () => {
    expect(isSwarmEligible(
      'Find the best cloud providers for AI workloads, compare their pricing, and verify their SLA guarantees',
    )).toBe(true);
  });

  it('returns true for multi-domain compound requests', () => {
    expect(isSwarmEligible(
      'Search for our GitHub issues, and also check my Outlook emails for any related customer complaints, plus investigate the Azure logs',
    )).toBe(true);
  });

  it('respects the scoring threshold', () => {
    // Single signal = not eligible
    expect(isSwarmEligible('find something')).toBe(false);
    // Two compound signals = eligible (score >= 3)
    expect(isSwarmEligible('compare the pros and cons of these alternatives')).toBe(true);
  });

  it('scores multiple question marks as multi-faceted', () => {
    expect(isSwarmEligible(
      'What is the best framework? How does it compare to competitors? What do experts recommend?',
    )).toBe(true);
  });
});

describe('ChatroomMessageSchema', () => {
  it('validates a correct chatroom message', () => {
    const result = ChatroomMessageSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      from: 'Alpha',
      to: 'Leader',
      content: 'Found 3 relevant results',
      contentType: 'partial_result',
      timestamp: Date.now(),
      correlationId: 'test-correlation-id',
    });
    expect(result.success).toBe(true);
  });

  it('defaults contentType to text', () => {
    const result = ChatroomMessageSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      from: 'Alpha',
      to: 'Leader',
      content: 'Hello',
      timestamp: Date.now(),
      correlationId: 'test-id',
    });
    expect(result.contentType).toBe('text');
  });

  it('accepts array recipients', () => {
    const result = ChatroomMessageSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      from: 'Alpha',
      to: ['Beta', 'Leader'],
      content: 'Cross-check this',
      timestamp: Date.now(),
      correlationId: 'test-id',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty from field', () => {
    const result = ChatroomMessageSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      from: '',
      to: 'Leader',
      content: 'test',
      timestamp: Date.now(),
      correlationId: 'test-id',
    });
    expect(result.success).toBe(false);
  });
});

describe('SwarmAgentSchema', () => {
  it('validates a correct agent definition', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Alpha',
      role: 'Research Specialist',
      task: 'Search for recent papers on AI alignment',
      assignedTools: ['github_search_issues', 'outlook_list_emails'],
      persona: 'You are Alpha, a focused research specialist...',
    });
    expect(result.success).toBe(true);
  });
});

describe('SwarmPlanSchema', () => {
  it('validates a complete plan', () => {
    const result = SwarmPlanSchema.safeParse({
      swarmId: '00000000-0000-4000-8000-000000000001',
      userQuery: 'Research AI providers and compare pricing',
      leader: {
        name: 'Leader',
        synthesisInstructions: 'Combine all findings into a structured comparison',
      },
      agents: [
        {
          name: 'Alpha',
          role: 'Research',
          task: 'Find AI providers',
          assignedTools: ['github_search_issues'],
          persona: 'You are Alpha...',
        },
        {
          name: 'Beta',
          role: 'Pricing',
          task: 'Compare pricing models',
          assignedTools: ['outlook_list_emails'],
          persona: 'You are Beta...',
        },
      ],
      timeoutMs: 60000,
      maxRoundsPerAgent: 4,
    });
    expect(result.success).toBe(true);
  });

  it('enforces 1-6 agents', () => {
    const base = {
      swarmId: '00000000-0000-4000-8000-000000000001',
      userQuery: 'test',
      leader: { name: 'Leader', synthesisInstructions: 'synth' },
      timeoutMs: 60000,
      maxRoundsPerAgent: 4,
    };

    // Zero agents — invalid
    const empty = SwarmPlanSchema.safeParse({ ...base, agents: [] });
    expect(empty.success).toBe(false);

    // 7 agents — invalid
    const tooMany = SwarmPlanSchema.safeParse({
      ...base,
      agents: Array.from({ length: 7 }, (_, i) => ({
        name: `Agent${i}`,
        role: 'role',
        task: 'task',
        assignedTools: [],
        persona: 'persona',
      })),
    });
    expect(tooMany.success).toBe(false);
  });

  it('enforces timeout bounds', () => {
    const base = {
      swarmId: '00000000-0000-4000-8000-000000000001',
      userQuery: 'test',
      leader: { name: 'Leader', synthesisInstructions: 'synth' },
      agents: [{ name: 'A', role: 'r', task: 't', assignedTools: [], persona: 'p' }],
      maxRoundsPerAgent: 4,
    };

    // Too low
    const low = SwarmPlanSchema.safeParse({ ...base, timeoutMs: 1000 });
    expect(low.success).toBe(false);

    // Too high
    const high = SwarmPlanSchema.safeParse({ ...base, timeoutMs: 200_000 });
    expect(high.success).toBe(false);
  });
});
