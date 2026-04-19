// Tests for swarm types and eligibility scoring
// Epic: #631

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isSwarmEligible, computeSwarmEligibilityScore, classifySwarmZone, getSwarmComplexityGate, SwarmPlanSchema, ChatroomMessageSchema, SwarmAgentSchema } from '../../src/orchestrator/swarm/swarmTypes.js';

describe('computeSwarmEligibilityScore', () => {
  it('returns 0 for simple greetings', () => {
    expect(computeSwarmEligibilityScore('hello')).toBe(0);
    expect(computeSwarmEligibilityScore('hi there')).toBe(0);
  });

  it('returns 10 for explicit swarm override phrases', () => {
    expect(computeSwarmEligibilityScore('use the swarm')).toBe(10);
    expect(computeSwarmEligibilityScore('ask your team to handle this')).toBe(10);
  });

  it('returns low score for single-verb queries', () => {
    const score = computeSwarmEligibilityScore('find something');
    expect(score).toBeLessThan(3);
  });

  it('returns high score for compound research queries', () => {
    const score = computeSwarmEligibilityScore(
      'Compare the pros and cons of React vs Vue, and also evaluate their ecosystem support',
    );
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it('scores multiple question marks', () => {
    const score = computeSwarmEligibilityScore(
      'What is the best? How does it compare? What do experts say?',
    );
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it('scores long multi-step research-plus-calculation prompts as always-swarm candidates (#691)', () => {
    const prompt = 'Research the exact current population of Munich, Germany in April 2026 along with today\'s high temperature and weather conditions there. Using that population figure, calculate precisely how many standard 12-inch pizzas would be needed if every single resident ate exactly 3 slices for lunch today, showing the full step-by-step math and final total. Then create a hilarious 100-word sci-fi news headline plus opening paragraph about Munich\'s entire population simultaneously ordering pizza via a rogue Grok swarm. Finally, merge everything into one clean final response.';
    const score = computeSwarmEligibilityScore(prompt);
    expect(score).toBeGreaterThanOrEqual(7);
    expect(classifySwarmZone(score)).toBe('always-swarm');
  });

  it('isSwarmEligible threshold matches score >= 3', () => {
    // Score < 3 → not eligible
    const lowScoreMsg = 'find something';
    expect(computeSwarmEligibilityScore(lowScoreMsg)).toBeLessThan(3);
    expect(isSwarmEligible(lowScoreMsg)).toBe(false);

    // Score >= 3 → eligible
    const highScoreMsg = 'compare the pros and cons of these alternatives';
    expect(computeSwarmEligibilityScore(highScoreMsg)).toBeGreaterThanOrEqual(3);
    expect(isSwarmEligible(highScoreMsg)).toBe(true);
  });

  it('geo-business composite: scores live-failure query as eligible (#653)', () => {
    // Empirically-proven live failure: "Find Fox Suspension service centers in Munich, Germany"
    // was scored 1 (below threshold) and returned a poor sequential response.
    const query = 'Find Fox Suspension service centers in Munich, Germany';
    expect(computeSwarmEligibilityScore(query)).toBeGreaterThanOrEqual(3);
    expect(isSwarmEligible(query)).toBe(true);
  });

  it('geo-business composite: scores certified dealer search as eligible (#653)', () => {
    expect(computeSwarmEligibilityScore('Find certified BMW dealers near Hamburg')).toBeGreaterThanOrEqual(3);
  });

  it('geo-business composite: does NOT fire on location-only (no business entity term) (#653)', () => {
    // "What's the weather in Paris" — has geo preposition but no business entity term
    expect(computeSwarmEligibilityScore("What's the weather in Paris")).toBeLessThan(3);
  });

  it('geo-business composite: does NOT fire on business-term-only (no location preposition) (#653)', () => {
    // "Tell me about dealers" — has business entity term but no geographic context
    expect(computeSwarmEligibilityScore('Tell me about dealers')).toBeLessThan(3);
  });
});

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

  it('triggers on explicit swarm override phrases', () => {
    expect(isSwarmEligible('that answer was shit, do it again but use the swarm')).toBe(true);
    expect(isSwarmEligible('use swarm mode for this')).toBe(true);
    expect(isSwarmEligible('ask your team to handle this')).toBe(true);
    expect(isSwarmEligible('try the swarm on this one')).toBe(true);
    expect(isSwarmEligible('swarm this')).toBe(true);
  });
});

describe('getSwarmComplexityGate', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('returns defaults when env vars are not set', () => {
    delete process.env['SWARM_ELIGIBILITY_THRESHOLD'];
    delete process.env['SWARM_ALWAYS_THRESHOLD'];
    const gate = getSwarmComplexityGate();
    expect(gate.sequentialCeiling).toBe(3);
    expect(gate.swarmFloor).toBe(7);
  });

  it('reads thresholds from env vars', () => {
    process.env['SWARM_ELIGIBILITY_THRESHOLD'] = '5';
    process.env['SWARM_ALWAYS_THRESHOLD'] = '9';
    const gate = getSwarmComplexityGate();
    expect(gate.sequentialCeiling).toBe(5);
    expect(gate.swarmFloor).toBe(9);
  });

  it('falls back to defaults for non-numeric env values', () => {
    process.env['SWARM_ELIGIBILITY_THRESHOLD'] = 'abc';
    process.env['SWARM_ALWAYS_THRESHOLD'] = '';
    const gate = getSwarmComplexityGate();
    expect(gate.sequentialCeiling).toBe(3);
    expect(gate.swarmFloor).toBe(7);
  });
});

describe('classifySwarmZone', () => {
  const defaultGate = { sequentialCeiling: 3, swarmFloor: 7 };

  it('returns always-sequential for low scores', () => {
    expect(classifySwarmZone(0, defaultGate)).toBe('always-sequential');
    expect(classifySwarmZone(2, defaultGate)).toBe('always-sequential');
  });

  it('returns maybe-swarm for mid-range scores', () => {
    expect(classifySwarmZone(3, defaultGate)).toBe('maybe-swarm');
    expect(classifySwarmZone(5, defaultGate)).toBe('maybe-swarm');
    expect(classifySwarmZone(6, defaultGate)).toBe('maybe-swarm');
  });

  it('returns always-swarm for high scores', () => {
    expect(classifySwarmZone(7, defaultGate)).toBe('always-swarm');
    expect(classifySwarmZone(10, defaultGate)).toBe('always-swarm');
  });

  it('respects custom gate thresholds', () => {
    const customGate = { sequentialCeiling: 5, swarmFloor: 9 };
    expect(classifySwarmZone(4, customGate)).toBe('always-sequential');
    expect(classifySwarmZone(5, customGate)).toBe('maybe-swarm');
    expect(classifySwarmZone(8, customGate)).toBe('maybe-swarm');
    expect(classifySwarmZone(9, customGate)).toBe('always-swarm');
  });

  it('uses env-based defaults when no gate provided', () => {
    // With default env (no vars set), uses 3 / 7
    expect(classifySwarmZone(2)).toBe('always-sequential');
    expect(classifySwarmZone(5)).toBe('maybe-swarm');
    expect(classifySwarmZone(10)).toBe('always-swarm');
  });

  it('non-always-sequential zone is equivalent to isSwarmEligible (#632 determinism)', () => {
    // The sessionOrchestrator uses planResult.swarmComplexityZone !== 'always-sequential'
    // instead of calling isSwarmEligible() directly (which reads env vars mid-orchestrator).
    // Verify the two conditions are semantically equivalent for default gate values.
    const defaultGate = { sequentialCeiling: 3, swarmFloor: 7 };
    for (const score of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const zone = classifySwarmZone(score, defaultGate);
      const eligibleByScore = score >= defaultGate.sequentialCeiling;
      const eligibleByZone = zone !== 'always-sequential';
      expect(eligibleByZone).toBe(eligibleByScore);
    }
  });
});

describe('isSwarmEligible with configurable threshold', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('uses SWARM_ELIGIBILITY_THRESHOLD when set', () => {
    // "compare the pros and cons of these alternatives" scores >= 3 with default
    const msg = 'compare the pros and cons of these alternatives';
    expect(isSwarmEligible(msg)).toBe(true); // default threshold 3

    // Raise threshold to 5 — same message should no longer be eligible
    process.env['SWARM_ELIGIBILITY_THRESHOLD'] = '5';
    const score = computeSwarmEligibilityScore(msg);
    if (score < 5) {
      expect(isSwarmEligible(msg)).toBe(false);
    }
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

describe('SwarmAgentSchema — tokenBudget (#647)', () => {
  it('accepts a valid positive integer tokenBudget', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Alpha',
      role: 'Research',
      task: 'Find things',
      assignedTools: [],
      tokenBudget: 8000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tokenBudget).toBe(8000);
    }
  });

  it('omits tokenBudget when not provided', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Beta',
      role: 'Analyst',
      task: 'Analyze data',
      assignedTools: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tokenBudget).toBeUndefined();
    }
  });

  it('rejects non-positive tokenBudget', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Gamma',
      role: 'Writer',
      task: 'Write report',
      assignedTools: [],
      tokenBudget: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer tokenBudget', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Delta',
      role: 'Editor',
      task: 'Edit report',
      assignedTools: [],
      tokenBudget: 1000.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative tokenBudget', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Epsilon',
      role: 'QA',
      task: 'Verify',
      assignedTools: [],
      tokenBudget: -100,
    });
    expect(result.success).toBe(false);
  });
});

describe('SwarmWorkerResult — tokenBudget fields (#647)', () => {
  it('includes budget fields when set', () => {
    const result = {
      agentName: 'Alpha',
      success: true,
      roundsUsed: 2,
      tokensUsed: 8500,
      toolCallsMade: 3,
      chatroomMessagesSent: 1,
      toolsUsed: ['web_search'],
      durationMs: 10_000,
      model: 'grok-4.1-fast',
      tokenBudget: 8000,
      tokenBudgetExceeded: true,
    } satisfies import('../../src/orchestrator/swarm/swarmTypes.js').SwarmWorkerResult;

    expect(result.tokenBudget).toBe(8000);
    expect(result.tokenBudgetExceeded).toBe(true);
  });

  it('omits budget fields when not set', () => {
    const result = {
      agentName: 'Beta',
      success: true,
      roundsUsed: 3,
      tokensUsed: 2000,
      toolCallsMade: 1,
      chatroomMessagesSent: 0,
      toolsUsed: [],
      durationMs: 5000,
      model: 'grok-4.1-fast',
    } satisfies import('../../src/orchestrator/swarm/swarmTypes.js').SwarmWorkerResult;

    expect(result.tokenBudget).toBeUndefined();
    expect(result.tokenBudgetExceeded).toBeUndefined();
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
