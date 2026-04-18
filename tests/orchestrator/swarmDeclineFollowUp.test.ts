import { describe, expect, it } from 'vitest';
import { sanitizeSwarmDeclineFollowUpContext } from '../../src/orchestrator/swarm/swarmDeclineFollowUp.js';

describe('sanitizeSwarmDeclineFollowUpContext', () => {
  it('removes activate_swarm from the assistant tool-call replay and injects an explicit decline result', () => {
    const context = sanitizeSwarmDeclineFollowUpContext({
      toolCalls: [
        { id: '1', name: 'activate_swarm', arguments: '{}' },
        { id: '2', name: 'mslearn_docs_search', arguments: '{"query":"fastify"}' },
      ],
      toolResults: [
        { toolCallId: '1', toolName: 'activate_swarm', success: true, result: { queued: true } },
        { toolCallId: '2', toolName: 'mslearn_docs_search', success: true, result: 'docs' },
      ],
      declineReason: 'Decomposer failed: timeout',
    });

    expect(context.toolCalls.map((call) => call.name)).toEqual(['mslearn_docs_search']);
    expect(context.toolResults).toEqual([
      {
        toolCallId: '1',
        toolName: 'activate_swarm',
        success: false,
        result: 'Swarm activation was declined by the decomposer. The swarm did not run. Answer directly and do not claim that Benjamin, Harper, or Lucas are currently researching.',
        error: 'Decomposer failed: timeout',
      },
      { toolCallId: '2', toolName: 'mslearn_docs_search', success: true, result: 'docs' },
    ]);
  });

  it('adds a synthetic decline result when activate_swarm had no recorded tool result yet', () => {
    const context = sanitizeSwarmDeclineFollowUpContext({
      toolCalls: [{ id: '1', name: 'activate_swarm', arguments: '{}' }],
      toolResults: [],
      declineReason: 'no plan returned',
    });

    expect(context.toolCalls).toEqual([]);
    expect(context.toolResults).toEqual([
      {
        toolCallId: 'activate_swarm-declined',
        toolName: 'activate_swarm',
        success: false,
        result: 'Swarm activation was declined by the decomposer. The swarm did not run. Answer directly and do not claim that Benjamin, Harper, or Lucas are currently researching.',
        error: 'no plan returned',
      },
    ]);
  });
});

describe('sessionOrchestrator swarm-decline wiring', () => {
  it('uses the decline sanitizer and short-circuit guard in the follow-up path', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

    expect(source).toContain('sanitizeSwarmDeclineFollowUpContext');
    expect(source).toContain('shouldShortCircuitSwarmDecline');
    expect(source).toContain('buildSwarmDeclineDirectResponse');
    expect(source).toContain('Answering directly only if I have enough verified evidence');
  });
});
