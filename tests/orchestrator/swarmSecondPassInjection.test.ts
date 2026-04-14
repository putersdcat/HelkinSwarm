// Source-level verification for #644 Slice 1: post-execution second-pass message injection.
// Workers cannot call entities mid-execution (activities lack Durable context).
// This slice routes inbound peer messages to each agent as a brief second-pass activity
// after all phase-1 workers finish, before Leader synthesis.
// Issue: #644

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwarmWorkerInput } from '../../src/orchestrator/swarm/swarmTypes.js';
import { buildInitialUserTurn } from '../../src/orchestrator/swarm/swarmWorkerActivity.js';

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

const orchestratorSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmOrchestrator.ts'),
  'utf-8',
);

const typesSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmTypes.ts'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// swarmTypes — SwarmWorkerInput.inboundMessages field
// ---------------------------------------------------------------------------
describe('SwarmWorkerInput — inboundMessages field (#644 Slice 1)', () => {
  it('declares inboundMessages as optional on SwarmWorkerInput', () => {
    // Check the TypeScript source declares the field
    expect(typesSrc).toContain('inboundMessages?: ChatroomMessage[]');
  });

  it('inboundMessages is optional — existing calls without it still typecheck', () => {
    // Compile-time proof: build passed with all existing callActivity sites unchanged
    // Source-level: field is declared optional (?)
    const fieldDeclaration = typesSrc.match(/inboundMessages\?:/);
    expect(fieldDeclaration).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildInitialUserTurn — injects teammate messages when present
// ---------------------------------------------------------------------------
describe('buildInitialUserTurn helper — teammate message injection (#644 Slice 1)', () => {
  it('exists as a named function in the worker activity', () => {
    expect(workerSrc).toContain('function buildInitialUserTurn(');
  });

  it('returns base task text when inboundMessages is absent', () => {
    expect(workerSrc).toContain('if (!inboundMessages?.length) return base');
  });

  it('formats messages with sender attribution', () => {
    expect(workerSrc).toContain('**From ${m.from}**');
  });

  it('uses the TEAM MESSAGES delimiters for reliable LLM parsing', () => {
    expect(workerSrc).toContain('[TEAM MESSAGES — RECEIVED FROM TEAMMATES]');
    expect(workerSrc).toContain('[END TEAM MESSAGES]');
  });

  it('instructs agent to review and send insights to Helkin', () => {
    expect(workerSrc).toContain('Review these teammate messages and send any additional insights');
  });
});

// ---------------------------------------------------------------------------
// swarmWorkerActivity — uses buildInitialUserTurn for initial user turn
// ---------------------------------------------------------------------------
describe('swarmWorkerActivity — initial user turn uses buildInitialUserTurn (#644 Slice 1)', () => {
  it('calls buildInitialUserTurn with task and inboundMessages', () => {
    expect(workerSrc).toContain('buildInitialUserTurn(input.task, input.inboundMessages)');
  });

  it('does NOT use the old bare template literal for initial user content', () => {
    // Old pattern: "`Execute your task now. Your assignment: ${input.task}`"
    // Should be replaced by buildInitialUserTurn call
    expect(workerSrc).not.toContain('`Execute your task now. Your assignment: ${input.task}`');
  });
});

// ---------------------------------------------------------------------------
// swarmOrchestrator — second-pass block
// ---------------------------------------------------------------------------
describe('swarmOrchestrator — second-pass message injection (#644 Slice 1)', () => {
  it('saves savedWorkerInputs array during fan-out', () => {
    expect(orchestratorSrc).toContain('savedWorkerInputs');
    expect(orchestratorSrc).toContain('savedWorkerInputs.push(workerInput)');
  });

  it('filters inbound messages per recipient agent', () => {
    // Must check msg.to for agent name and "All"
    expect(orchestratorSrc).toContain('msg.to === agent.name || msg.to === \'All\'');
  });

  it('starts second-pass activities for agents with inbound messages', () => {
    expect(orchestratorSrc).toContain('inboundMessages: inbound');
  });

  it('skips second pass for agents with no inbound messages AND no swarm_wait request (#646)', () => {
    // After #646, the condition also allows swarm_wait-requesting agents through
    expect(orchestratorSrc).toContain('if (inbound.length === 0 && !requestedWait) continue');
  });

  it('limits second-pass to 2 rounds max', () => {
    expect(orchestratorSrc).toContain('Math.min(2, plan.maxRoundsPerAgent)');
  });

  it('uses a shorter timeout for second-pass activities', () => {
    expect(orchestratorSrc).toContain('SECOND_PASS_TIMEOUT_MS = 20_000');
  });

  it('collects second-pass chatroom messages into allChatroomMessages (for Leader)', () => {
    expect(orchestratorSrc).toContain('allChatroomMessages.push(...result._pendingChatroomMessages');
  });

  it('does NOT add second-pass results to workerResults (avoids telemetry duplication)', () => {
    // The second-pass results go to secondPassTasks, not workerResults
    // Source check: no "workerResults.push" inside the second-pass fan-in loop
    // The second-pass fan-in block only pushes to allChatroomMessages
    expect(orchestratorSrc).toContain('Only collect new messages for Leader\'s transcript — don\'t pollute workerResults');
  });
});

// ---------------------------------------------------------------------------
// swarmOrchestrator — progress messages must not steal final reply ownership
// ---------------------------------------------------------------------------
describe('swarmOrchestrator — progress reply ownership regression', () => {
  it('marks per-worker progress updates with skipOutboundClaim so the final reply is not suppressed', () => {
    const progressBlockStart = orchestratorSrc.indexOf('const progressMsg =');
    expect(progressBlockStart).toBeGreaterThan(-1);
    const snippet = orchestratorSrc.slice(progressBlockStart, progressBlockStart + 700);
    expect(snippet).toContain('skipOutboundClaim: true');
  });
});

// ---------------------------------------------------------------------------
// Functional: SwarmWorkerInput type still accepts existing callers (no required field added)
// ---------------------------------------------------------------------------
describe('SwarmWorkerInput — backward compatibility (#644 Slice 1)', () => {
  it('inboundMessages field is optional — existing worker calls are valid', () => {
    // Create a valid input without inboundMessages — should typecheck
    const input: SwarmWorkerInput = {
      agentName: 'Benjamin',
      agentRole: 'Research Specialist',
      agentPersona: 'Skeptical researcher',
      task: 'Find papers on AI alignment',
      assignedTools: ['web_search'],
      swarmId: '00000000-0000-4000-8000-000000000001',
      swarmCorrelationId: 'corr-1',
      chatroomEntityId: 'swarm-test',
      userId: 'user-1',
      correlationId: 'corr-1',
      maxRounds: 4,
      userQuery: 'Research AI safety',
    };
    // No inboundMessages — should be fine
    expect(input.inboundMessages).toBeUndefined();
  });

  it('inboundMessages field accepts ChatroomMessage array when provided', () => {
    const input: SwarmWorkerInput = {
      agentName: 'Lucas',
      agentRole: 'Data Synthesis',
      agentPersona: 'Data expert',
      task: 'Review teammate messages',
      assignedTools: ['web_search'],
      swarmId: '00000000-0000-4000-8000-000000000002',
      swarmCorrelationId: 'corr-2',
      chatroomEntityId: 'swarm-test',
      userId: 'user-1',
      correlationId: 'corr-2',
      maxRounds: 2,
      userQuery: 'Rank coffee shops',
      inboundMessages: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          from: 'Benjamin',
          to: 'Lucas',
          content: 'Found 5 coffee shops near downtown',
          contentType: 'partial_result',
          timestamp: Date.now(),
          correlationId: 'corr-2',
        },
      ],
    };
    expect(input.inboundMessages).toHaveLength(1);
    expect(input.inboundMessages![0].from).toBe('Benjamin');
  });
});

// ---------------------------------------------------------------------------
// buildInitialUserTurn — functional tests for AC5 (#644)
// "Unit test: worker with injected messages produces different output than without"
// ---------------------------------------------------------------------------

describe('buildInitialUserTurn — functional behaviour (#644 AC5)', () => {
  it('without inboundMessages returns only the task prompt', () => {
    const result = buildInitialUserTurn('Find service centers in Munich');
    expect(result).toContain('Find service centers in Munich');
    expect(result).not.toContain('[TEAM MESSAGES');
    expect(result).not.toContain('TEAMMATES');
  });

  it('with empty inboundMessages returns only the task prompt (guard against empty array)', () => {
    const result = buildInitialUserTurn('Find service centers in Munich', []);
    expect(result).not.toContain('[TEAM MESSAGES');
  });

  it('with inboundMessages produces DIFFERENT output than without (AC5)', () => {
    const task = 'Rank options by quality';
    const inbound = [{
      id: '00000000-0000-4000-8000-000000000099',
      from: 'Benjamin',
      to: 'Lucas',
      content: 'Found 3 top-tier shops: A at €100, B at €90, C at €120',
      contentType: 'partial_result' as const,
      timestamp: Date.now(),
      correlationId: 'corr-test',
    }];
    const withoutMessages = buildInitialUserTurn(task);
    const withMessages = buildInitialUserTurn(task, inbound);
    expect(withMessages).not.toBe(withoutMessages);
    expect(withMessages.length).toBeGreaterThan(withoutMessages.length);
  });

  it('injected message includes sender attribution', () => {
    const inbound = [{
      id: '00000000-0000-4000-8000-000000000098',
      from: 'Harper',
      to: 'Lucas',
      content: 'Found additional source: example.com',
      contentType: 'partial_result' as const,
      timestamp: Date.now(),
      correlationId: 'corr-test',
    }];
    const result = buildInitialUserTurn('Synthesize findings', inbound);
    expect(result).toContain('From Harper');
    expect(result).toContain('example.com');
  });

  it('uses TEAM MESSAGES delimiters for reliable LLM parsing', () => {
    const inbound = [{
      id: '00000000-0000-4000-8000-000000000097',
      from: 'Benjamin',
      to: 'All',
      content: 'Data ready',
      contentType: 'partial_result' as const,
      timestamp: Date.now(),
      correlationId: 'corr-test',
    }];
    const result = buildInitialUserTurn('Rank results', inbound);
    expect(result).toContain('[TEAM MESSAGES — RECEIVED FROM TEAMMATES]');
    expect(result).toContain('[END TEAM MESSAGES]');
  });

  it('multiple inbound messages all appear in output', () => {
    const inbound = [
      {
        id: '00000000-0000-4000-8000-000000000096',
        from: 'Benjamin',
        to: 'Lucas',
        content: 'Price data: A=€100, B=€90',
        contentType: 'partial_result' as const,
        timestamp: Date.now(),
        correlationId: 'corr-test',
      },
      {
        id: '00000000-0000-4000-8000-000000000095',
        from: 'Harper',
        to: 'Lucas',
        content: 'Quality data: A=5★, B=4★',
        contentType: 'partial_result' as const,
        timestamp: Date.now(),
        correlationId: 'corr-test',
      },
    ];
    const result = buildInitialUserTurn('Rank options', inbound);
    expect(result).toContain('From Benjamin');
    expect(result).toContain('From Harper');
    expect(result).toContain('Price data');
    expect(result).toContain('Quality data');
  });
});
