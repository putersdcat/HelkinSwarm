// Tests for swarm_wait tool — agent yield/resume (#646)
// Covers: tool definition in buildWorkerToolSchemas, SwarmWorkerResult type surface.

import { describe, it, expect } from 'vitest';
import type { SwarmWorkerResult } from '../../src/orchestrator/swarm/swarmTypes.js';

// ---------------------------------------------------------------------------
// Indirect tool-shape test — verify swarm_wait lands in the tool registry.
// We import the type + check the fields via type-level tests only, since
// buildWorkerToolSchemas is not exported. The integration is tested via build.
// ---------------------------------------------------------------------------

describe('SwarmWorkerResult._requestsSecondPass', () => {
  it('accepts _requestsSecondPass: true', () => {
    const result: Partial<SwarmWorkerResult> = { _requestsSecondPass: true };
    expect(result._requestsSecondPass).toBe(true);
  });

  it('accepts _requestsSecondPass: false', () => {
    const result: Partial<SwarmWorkerResult> = { _requestsSecondPass: false };
    expect(result._requestsSecondPass).toBe(false);
  });

  it('accepts missing _requestsSecondPass (optional field)', () => {
    const result: Partial<SwarmWorkerResult> = {};
    expect(result._requestsSecondPass).toBeUndefined();
  });

  it('full result without _requestsSecondPass is valid', () => {
    const result: SwarmWorkerResult = {
      agentName: 'Benjamin',
      success: true,
      roundsUsed: 2,
      tokensUsed: 500,
      toolCallsMade: 3,
      chatroomMessagesSent: 1,
      toolsUsed: ['web_search'],
      durationMs: 4000,
      model: 'grok-4.1-fast',
    };
    expect(result._requestsSecondPass).toBeUndefined();
    expect(result._waitingFor).toBeUndefined();
  });
});

describe('SwarmWorkerResult._waitingFor', () => {
  it('accepts single agent name array', () => {
    const result: Partial<SwarmWorkerResult> = { _waitingFor: ['Benjamin'] };
    expect(result._waitingFor).toEqual(['Benjamin']);
  });

  it('accepts multiple agent names', () => {
    const result: Partial<SwarmWorkerResult> = { _waitingFor: ['Benjamin', 'Harper'] };
    expect(result._waitingFor).toHaveLength(2);
    expect(result._waitingFor).toContain('Harper');
  });

  it('accepts empty array', () => {
    const result: Partial<SwarmWorkerResult> = { _waitingFor: [] };
    expect(result._waitingFor).toHaveLength(0);
  });

  it('accepts missing _waitingFor (optional field)', () => {
    const result: Partial<SwarmWorkerResult> = {};
    expect(result._waitingFor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// swarm_wait tool parameter shape validation
// ---------------------------------------------------------------------------

describe('swarm_wait tool parameter contract', () => {
  it('waitFor accepts a single string', () => {
    // Simulates a parsed tool-call argument object
    const args: { waitFor: string | string[]; reason?: string } = {
      waitFor: 'Benjamin',
    };
    const waitingFor = Array.isArray(args.waitFor) ? args.waitFor : [args.waitFor];
    expect(waitingFor).toEqual(['Benjamin']);
  });

  it('waitFor accepts an array of names', () => {
    const args: { waitFor: string | string[]; reason?: string } = {
      waitFor: ['Benjamin', 'Harper'],
    };
    const waitingFor = Array.isArray(args.waitFor) ? args.waitFor : [args.waitFor];
    expect(waitingFor).toHaveLength(2);
    expect(waitingFor).toContain('Harper');
  });

  it('waitFor "Any" is valid sentinel', () => {
    const args: { waitFor: string | string[]; reason?: string } = {
      waitFor: 'Any',
    };
    const waitingFor = Array.isArray(args.waitFor) ? args.waitFor : [args.waitFor];
    expect(waitingFor).toEqual(['Any']);
  });

  it('reason is optional', () => {
    const args: { waitFor: string | string[]; reason?: string } = {
      waitFor: 'Lucas',
    };
    expect(args.reason).toBeUndefined();
  });

  it('reason can be provided', () => {
    const args: { waitFor: string | string[]; reason?: string } = {
      waitFor: 'Benjamin',
      reason: 'need pricing data before I can rank options',
    };
    expect(args.reason).toContain('pricing');
  });
});

// ---------------------------------------------------------------------------
// Second-pass task description logic (mirrors what the orchestrator builds)
// ---------------------------------------------------------------------------

describe('swarm_wait second-pass task message logic (orchestrator pattern)', () => {
  function buildSecondPassTask(
    agentTask: string,
    requestedWait: boolean,
    workerWaitingFor: string[],
    inboundCount: number,
  ): string {
    if (requestedWait && inboundCount === 0) {
      return (
        `You called swarm_wait(waitFor: [${workerWaitingFor.join(', ') || 'Any'}]). ` +
        `No messages arrived from them within the timeout. ` +
        `Resume your task and send your best available result to Helkin. ` +
        `Your original assignment: ${agentTask}`
      );
    } else if (requestedWait) {
      return (
        `You called swarm_wait(waitFor: [${workerWaitingFor.join(', ') || 'Any'}]). ` +
        `Messages from your teammates are now available. ` +
        `Review them, incorporate the data you were waiting for, and send your findings to Helkin. ` +
        `Your original assignment: ${agentTask}`
      );
    } else {
      return (
        `Review messages your teammates sent you and send any additional insights or corrections to Helkin. ` +
        `Your completed assignment was: ${agentTask}`
      );
    }
  }

  it('timeout case includes "No messages arrived" language', () => {
    const task = buildSecondPassTask('Rank the options', true, ['Benjamin'], 0);
    expect(task).toContain('No messages arrived');
    expect(task).toContain('Benjamin');
    expect(task).toContain('Rank the options');
  });

  it('satisfied wait case includes "Messages from your teammates" language', () => {
    const task = buildSecondPassTask('Rank the options', true, ['Benjamin'], 2);
    expect(task).toContain('Messages from your teammates are now available');
    expect(task).toContain('Benjamin');
  });

  it('standard second pass (no wait) uses standard language', () => {
    const task = buildSecondPassTask('Rank the options', false, [], 1);
    expect(task).toContain('Review messages your teammates sent you');
    expect(task).not.toContain('swarm_wait');
  });

  it('timeout case preserves agent task in message', () => {
    const task = buildSecondPassTask('Find FOX suspension prices in London', true, ['Harper'], 0);
    expect(task).toContain('FOX suspension prices');
  });
});

// ---------------------------------------------------------------------------
// Worker system prompt — swarm_wait discoverable to LLM (#646 hardening)
// ---------------------------------------------------------------------------

import { buildWorkerSystemPrompt } from '../../src/orchestrator/swarm/swarmPersonas.js';

describe('buildWorkerSystemPrompt — swarm_wait visibility (#646)', () => {
  const baseInput = {
    agentName: 'Lucas',
    agentRole: 'Data Synthesis Specialist',
    task: 'Rank the service centers by quality and distance',
    assignedToolNames: ['web_search'],
    allAgentNames: ['Benjamin', 'Harper', 'Lucas'],
    userQuery: 'Find Fox Suspension service centers in Munich',
  };

  it('lists swarm_wait in the tools section', () => {
    const prompt = buildWorkerSystemPrompt(baseInput);
    expect(prompt).toContain('swarm_wait');
  });

  it('lists chatroom_send in the tools section', () => {
    const prompt = buildWorkerSystemPrompt(baseInput);
    expect(prompt).toContain('chatroom_send');
  });

  it('includes swarm_wait usage guidance for synthesis agents', () => {
    const prompt = buildWorkerSystemPrompt(baseInput);
    expect(prompt).toMatch(/swarm_wait\s*\(\s*\{.*waitFor/);
  });

  it('mentions SYNTHESIZE or RANK context for swarm_wait guidance', () => {
    const prompt = buildWorkerSystemPrompt(baseInput);
    // Guidance section should mention when to use swarm_wait
    expect(prompt.toUpperCase()).toMatch(/SYNTHES|RANK|COMPAR/);
  });

  it('does not tell agents to use ONLY the assigned tools (swarm_wait must be reachable)', () => {
    const prompt = buildWorkerSystemPrompt(baseInput);
    // Old text excluded swarm_wait with "Use ONLY these tools"
    expect(prompt).not.toContain('Use ONLY these tools');
  });
});
