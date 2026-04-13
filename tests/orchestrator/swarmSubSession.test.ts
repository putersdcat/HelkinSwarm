// Tests for swarm sub-session type surface — #638 Slice 1
// Covers: contentType schema, sub_session_request message structure,
//         ChatroomMessage validation for new contentType variants.

import { describe, it, expect } from 'vitest';
import { ChatroomMessageSchema } from '../../src/orchestrator/swarm/swarmTypes.js';
import type { ChatroomMessage } from '../../src/orchestrator/swarm/swarmTypes.js';

// ---------------------------------------------------------------------------
// contentType enum — verify new variants are accepted
// ---------------------------------------------------------------------------

describe('ChatroomMessage contentType — sub_session_request', () => {
  it('accepts contentType: sub_session_request', () => {
    const msg: ChatroomMessage = {
      id: '00000000-0000-4000-8000-000000000001',
      from: 'Benjamin',
      to: 'Leader',
      content: JSON.stringify({ toolName: 'outlook_list_emails', toolArgs: {}, requestingAgent: 'Benjamin' }),
      contentType: 'sub_session_request',
      timestamp: Date.now(),
      correlationId: 'corr-test',
    };
    const result = ChatroomMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('accepts contentType: sub_session_result', () => {
    const msg: ChatroomMessage = {
      id: '00000000-0000-4000-8000-000000000002',
      from: 'Leader',
      to: 'Benjamin',
      content: JSON.stringify({ toolName: 'outlook_list_emails', result: '[]' }),
      contentType: 'sub_session_result',
      timestamp: Date.now(),
      correlationId: 'corr-test',
    };
    const result = ChatroomMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('rejects unknown contentType', () => {
    const raw = {
      id: '00000000-0000-4000-8000-000000000003',
      from: 'Benjamin',
      to: 'Leader',
      content: 'test',
      contentType: 'not_a_valid_type',
      timestamp: Date.now(),
      correlationId: 'corr-test',
    };
    const result = ChatroomMessageSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sub_session_request payload contract
// ---------------------------------------------------------------------------

describe('sub_session_request payload structure', () => {
  it('content parses to expected fields', () => {
    const payload = {
      toolName: 'github_list_issues',
      toolArgs: { owner: 'putersdcat', repo: 'HelkinSwarm' },
      requestingAgent: 'Lucas',
    };
    const msg: ChatroomMessage = {
      id: '00000000-0000-4000-8000-000000000004',
      from: 'Lucas',
      to: 'Leader',
      content: JSON.stringify(payload),
      contentType: 'sub_session_request',
      timestamp: Date.now(),
      correlationId: 'corr-test',
    };
    const validated = ChatroomMessageSchema.safeParse(msg);
    expect(validated.success).toBe(true);

    const parsed = JSON.parse(msg.content) as typeof payload;
    expect(parsed.toolName).toBe('github_list_issues');
    expect(parsed.requestingAgent).toBe('Lucas');
    expect(parsed.toolArgs).toMatchObject({ owner: 'putersdcat' });
  });

  it('sub_session_request is always addressed to Leader', () => {
    const msg: ChatroomMessage = {
      id: '00000000-0000-4000-8000-000000000005',
      from: 'Harper',
      to: 'Leader',
      content: JSON.stringify({ toolName: 'teams_send_message', toolArgs: {}, requestingAgent: 'Harper' }),
      contentType: 'sub_session_request',
      timestamp: Date.now(),
      correlationId: 'corr-test',
    };
    const validated = ChatroomMessageSchema.safeParse(msg);
    expect(validated.success).toBe(true);
    expect(validated.data?.to).toBe('Leader');
  });
});

// ---------------------------------------------------------------------------
// Backward compat — existing contentType variants still accepted
// ---------------------------------------------------------------------------

describe('existing contentType variants remain valid', () => {
  const variants: ChatroomMessage['contentType'][] = [
    'text', 'partial_result', 'cross_verification', 'question',
    'delegation', 'vote', 'error', 'status',
  ];

  for (const ct of variants) {
    it(`accepts contentType: ${ct}`, () => {
      const msg = {
        id: '00000000-0000-4000-8000-000000000010',
        from: 'Agent',
        to: 'Leader',
        content: 'test',
        contentType: ct,
        timestamp: Date.now(),
        correlationId: 'corr-test',
      };
      const result = ChatroomMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  }
});
