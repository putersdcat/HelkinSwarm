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

  it('returns true for multi-faceted analysis without explicit compare keyword', () => {
    expect(isSwarmEligible(
      'Analyze three different approaches to building a real-time collaborative document editor: CRDTs vs OT vs hybrid approaches. For each, research the technical tradeoffs (latency, consistency, conflict resolution), identify major open-source implementations and their GitHub activity, and investigate which companies chose each approach and their engineering blog posts explaining why. Present a decision matrix with weighted scoring.',
    )).toBe(true);
  });

  it('awards bonus for 3+ distinct research verbs', () => {
    // 3 verbs: find, research, investigate → +2 instead of +1
    // length > 200 → +1 = total 3 → eligible
    expect(isSwarmEligible(
      'Find current market data across all major indices, research the competitive landscape for enterprise SaaS companies, and investigate emerging trends in the renewable energy sector across multiple geographic regions for comprehensive context gathering',
    )).toBe(true);
  });

  // Regression: owner's live queries from 2026-04-12 that SHOULD trigger swarm
  it('triggers for microservices vs monolithic query (live regression)', () => {
    expect(isSwarmEligible(
      'Research the advantages and disadvantages of microservices versus monolithic architecture, compare their scalability characteristics and maintenance overhead for different team sizes, and analyze what industry experts recommend for startups compared to large enterprises',
    )).toBe(true);
  });

  it('triggers for React vs Vue framework comparison (live regression)', () => {
    expect(isSwarmEligible(
      'Compare the key differences between React and Vue frameworks — analyze their performance characteristics, ecosystem maturity, and learning curve, and also research what major companies use each one and why',
    )).toBe(true);
  });

  it('triggers for CRDTs vs OT deep analysis (live regression)', () => {
    expect(isSwarmEligible(
      'Analyze three different approaches to building a real-time collaborative document editor: CRDTs vs OT vs hybrid approaches. For each, research the technical tradeoffs (latency, consistency, conflict resolution), identify major open-source implementations and their GitHub activity, and investigate which companies chose each approach and their engineering blog posts explaining why. Present a decision matrix with weighted scoring.',
    )).toBe(true);
  });
  // Regression: #632 C4 — this exact query went through the normal path
  // because classifyComplexity() returned 'simple' (no sequential connectors),
  // even though isSwarmEligible scores it at 4.
  it('triggers for CRDT vs OT comparison query (#632 C4 regression)', () => {
    expect(isSwarmEligible(
      'Compare the tradeoffs between CRDT and OT approaches for real-time collaborative editing, evaluating consistency guarantees, latency characteristics, and adoption in modern frameworks like Yjs, Automerge, and ShareDB',
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

  it('applies persona default when omitted', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Gamma',
      role: 'Analyst',
      task: 'Analyze pricing data',
      assignedTools: ['web_search'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.persona).toBe('Focused and thorough research agent');
    }
  });

  it('accepts explicit persona over default', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Delta',
      role: 'Expert',
      task: 'Deep dive into X',
      assignedTools: [],
      persona: 'You are a domain expert on topic X',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.persona).toBe('You are a domain expert on topic X');
    }
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

describe('SwarmWorkerResult — telemetry fields', () => {
  it('includes toolsUsed and durationMs', () => {
    // Structural type check — an object satisfying SwarmWorkerResult must include the new fields
    const result = {
      agentName: 'Alpha',
      success: true,
      roundsUsed: 2,
      tokensUsed: 500,
      toolCallsMade: 3,
      chatroomMessagesSent: 2,
      toolsUsed: ['web_search', 'web_fetch_page'],
      durationMs: 12_345,
      model: 'grok-4.1-fast',
    } satisfies import('../../src/orchestrator/swarm/swarmTypes.js').SwarmWorkerResult;

    expect(result.toolsUsed).toEqual(['web_search', 'web_fetch_page']);
    expect(result.durationMs).toBe(12_345);
  });

  it('includes toolsUsed and durationMs in error case', () => {
    const result = {
      agentName: 'Beta',
      success: false,
      roundsUsed: 1,
      tokensUsed: 100,
      toolCallsMade: 0,
      chatroomMessagesSent: 0,
      toolsUsed: [],
      durationMs: 500,
      error: 'LLM call failed',
      model: 'grok-4.1-fast',
    } satisfies import('../../src/orchestrator/swarm/swarmTypes.js').SwarmWorkerResult;

    expect(result.toolsUsed).toEqual([]);
    expect(result.durationMs).toBe(500);
    expect(result.error).toBeDefined();
  });
});

describe('SwarmAgentCost — telemetry fields', () => {
  it('includes toolsUsed and durationMs', () => {
    const cost = {
      agent: 'Alpha',
      tokens: 500,
      model: 'grok-4.1-fast',
      toolsUsed: ['web_search'],
      durationMs: 8000,
    } satisfies import('../../src/orchestrator/swarm/swarmTypes.js').SwarmAgentCost;

    expect(cost.toolsUsed).toEqual(['web_search']);
    expect(cost.durationMs).toBe(8000);
  });
});
