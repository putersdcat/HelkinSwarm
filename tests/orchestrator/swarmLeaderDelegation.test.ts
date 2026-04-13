// Tests for Leader delegation mode — #644 Slice 2 / #645
// Covers: buildLeaderDelegationPrompt, SwarmLeaderInput.delegationMode,
// SwarmLeaderResult._pendingChatroomMessages type surface.

import { describe, it, expect } from 'vitest';
import { buildLeaderDelegationPrompt } from '../../src/orchestrator/swarm/swarmPersonas.js';
import type { SwarmLeaderInput, SwarmLeaderResult, ChatroomMessage } from '../../src/orchestrator/swarm/swarmTypes.js';

// ---------------------------------------------------------------------------
// buildLeaderDelegationPrompt — prompt content
// ---------------------------------------------------------------------------

describe('buildLeaderDelegationPrompt', () => {
  const baseInput = {
    userQuery: 'Which London shops sell Öhlins suspension?',
    agentNames: ['Benjamin', 'Harper', 'Lucas'],
  };

  it('includes user query verbatim', () => {
    const prompt = buildLeaderDelegationPrompt(baseInput);
    expect(prompt).toContain('Which London shops sell Öhlins suspension?');
  });

  it('includes all agent names', () => {
    const prompt = buildLeaderDelegationPrompt(baseInput);
    expect(prompt).toContain('Benjamin');
    expect(prompt).toContain('Harper');
    expect(prompt).toContain('Lucas');
  });

  it('instructs NOT to produce final synthesis', () => {
    const prompt = buildLeaderDelegationPrompt(baseInput);
    expect(prompt.toLowerCase()).toMatch(/do not.*final|not.*final answer|not.*write.*final/);
  });

  it('explicitly restricts to chatroom_send only', () => {
    const prompt = buildLeaderDelegationPrompt(baseInput);
    expect(prompt).toContain('chatroom_send');
    expect(prompt).toContain('ONLY');
  });

  it('names the phase as Active Coordination', () => {
    const prompt = buildLeaderDelegationPrompt(baseInput);
    expect(prompt).toContain('Active Coordination');
  });

  it('mentions delegation and question contentTypes', () => {
    const prompt = buildLeaderDelegationPrompt(baseInput);
    expect(prompt).toContain('delegation');
    expect(prompt).toContain('question');
  });

  it('produces a non-empty string', () => {
    const prompt = buildLeaderDelegationPrompt(baseInput);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('works with a single agent name', () => {
    const prompt = buildLeaderDelegationPrompt({
      userQuery: 'test',
      agentNames: ['Solo'],
    });
    expect(prompt).toContain('Solo');
  });

  it('works with empty agent names array', () => {
    // Should not throw; graceful empty list
    expect(() => buildLeaderDelegationPrompt({ userQuery: 'q', agentNames: [] })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SwarmLeaderInput — delegationMode field surface check
// ---------------------------------------------------------------------------

describe('SwarmLeaderInput.delegationMode', () => {
  it('accepts delegationMode: true', () => {
    // Type-level test: if this compiles the interface is correct
    const input: Partial<SwarmLeaderInput> = { delegationMode: true };
    expect(input.delegationMode).toBe(true);
  });

  it('accepts delegationMode: false', () => {
    const input: Partial<SwarmLeaderInput> = { delegationMode: false };
    expect(input.delegationMode).toBe(false);
  });

  it('accepts missing delegationMode (optional field)', () => {
    const input: Partial<SwarmLeaderInput> = {};
    expect(input.delegationMode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SwarmLeaderResult — _pendingChatroomMessages field surface check
// ---------------------------------------------------------------------------

describe('SwarmLeaderResult._pendingChatroomMessages', () => {
  it('accepts _pendingChatroomMessages array', () => {
    const msg: ChatroomMessage = {
      id: 'test-id',
      from: 'Helkin',
      to: 'Benjamin',
      content: 'Please verify the FOX suspension pricing claim',
      contentType: 'delegation',
      timestamp: Date.now(),
      correlationId: 'corr-1',
    };
    const result: Partial<SwarmLeaderResult> = { _pendingChatroomMessages: [msg] };
    expect(result._pendingChatroomMessages).toHaveLength(1);
    expect(result._pendingChatroomMessages![0].contentType).toBe('delegation');
  });

  it('accepts empty _pendingChatroomMessages array', () => {
    const result: Partial<SwarmLeaderResult> = { _pendingChatroomMessages: [] };
    expect(result._pendingChatroomMessages).toHaveLength(0);
  });

  it('accepts missing _pendingChatroomMessages (optional field)', () => {
    const result: Partial<SwarmLeaderResult> = {};
    expect(result._pendingChatroomMessages).toBeUndefined();
  });

  it('synthesis mode result does not require _pendingChatroomMessages', () => {
    const result: SwarmLeaderResult = {
      synthesis: 'Here is the final answer',
      success: true,
      tokensUsed: 1234,
      roundsUsed: 1,
      agentsHeardFrom: ['Benjamin', 'Harper'],
      model: 'gpt-4o',
    };
    expect(result._pendingChatroomMessages).toBeUndefined();
  });
});
