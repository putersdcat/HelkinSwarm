// Tests for the canonical chatroom_send wire contract (#673).
// Covers envelope parsing, self-echo guard, and backwards compatibility.

import { describe, it, expect } from 'vitest';
import {
  parseChatroomSendMessage,
  isSelfEcho,
  stripSelfEchoRecipients,
} from '../../src/orchestrator/swarm/chatroomEnvelope.js';
import {
  CanonicalChatroomPayloadSchema,
  ChatroomMessageSchema,
} from '../../src/orchestrator/swarm/swarmTypes.js';

describe('parseChatroomSendMessage — canonical envelope (#673)', () => {
  it('parses a valid canonical payload', () => {
    const raw = JSON.stringify({
      messageType: 'contribution',
      content: 'Found Schumacher shop in Munich — FOX certified',
      confidence: 85,
      sender: 'Benjamin',
    });
    const result = parseChatroomSendMessage(raw, 'Benjamin');
    expect(result.legacy).toBe(false);
    expect(result.payload).toBeDefined();
    expect(result.payload?.messageType).toBe('contribution');
    expect(result.payload?.confidence).toBe(85);
    expect(result.payload?.sender).toBe('Benjamin');
    expect(result.displayContent).toBe('Found Schumacher shop in Munich — FOX certified');
  });

  it('accepts every canonical messageType', () => {
    const types = [
      'thinking',
      'tool_summary',
      'analysis',
      'response',
      'question',
      'contribution',
      'final_contribution',
    ] as const;
    for (const t of types) {
      const raw = JSON.stringify({ messageType: t, content: 'x', confidence: 50, sender: 'X' });
      expect(parseChatroomSendMessage(raw, 'X').payload?.messageType).toBe(t);
    }
  });

  it('rejects invalid messageType → legacy fallback', () => {
    const raw = JSON.stringify({
      messageType: 'gibberish',
      content: 'x',
      confidence: 50,
      sender: 'Harper',
    });
    const result = parseChatroomSendMessage(raw, 'Harper');
    expect(result.legacy).toBe(true);
    expect(result.payload).toBeUndefined();
    expect(result.displayContent).toBe(raw);
  });

  it('rejects out-of-range confidence → legacy fallback', () => {
    const raw = JSON.stringify({
      messageType: 'contribution',
      content: 'x',
      confidence: 150,
      sender: 'Harper',
    });
    expect(parseChatroomSendMessage(raw, 'Harper').legacy).toBe(true);
  });

  it('treats freeform text as legacy', () => {
    const raw = 'just a plain string, no json';
    const result = parseChatroomSendMessage(raw, 'Lucas');
    expect(result.legacy).toBe(true);
    expect(result.payload).toBeUndefined();
    expect(result.displayContent).toBe(raw);
  });

  it('treats broken JSON as legacy', () => {
    const raw = '{"messageType": "contribution", broken';
    const result = parseChatroomSendMessage(raw, 'Lucas');
    expect(result.legacy).toBe(true);
    expect(result.displayContent).toBe(raw);
  });

  it('treats JSON that is not an object as legacy', () => {
    expect(parseChatroomSendMessage('["array"]', 'Lucas').legacy).toBe(true);
    expect(parseChatroomSendMessage('"bare string"', 'Lucas').legacy).toBe(true);
  });

  it('handles empty input safely', () => {
    const result = parseChatroomSendMessage('', 'Benjamin');
    expect(result.legacy).toBe(true);
    expect(result.displayContent).toBe('');
  });
});

describe('self-echo guards (#673)', () => {
  it('isSelfEcho detects self in single recipient', () => {
    expect(isSelfEcho('Benjamin', 'Benjamin')).toBe(true);
    expect(isSelfEcho('Benjamin', 'benjamin')).toBe(true); // case-insensitive
    expect(isSelfEcho('Benjamin', 'Helkin')).toBe(false);
  });

  it('isSelfEcho detects self in array recipient', () => {
    expect(isSelfEcho('Benjamin', ['Harper', 'Benjamin'])).toBe(true);
    expect(isSelfEcho('Benjamin', ['Harper', 'Lucas'])).toBe(false);
  });

  it('stripSelfEchoRecipients removes sender from array', () => {
    const result = stripSelfEchoRecipients('Benjamin', ['Harper', 'Benjamin', 'Lucas']);
    expect(result).toEqual(['Harper', 'Lucas']);
  });

  it('stripSelfEchoRecipients redirects to Helkin when only self was addressed', () => {
    expect(stripSelfEchoRecipients('Benjamin', 'Benjamin')).toBe('Helkin');
    expect(stripSelfEchoRecipients('Benjamin', ['Benjamin'])).toBe('Helkin');
  });

  it('stripSelfEchoRecipients preserves single non-self recipient', () => {
    expect(stripSelfEchoRecipients('Benjamin', 'Helkin')).toBe('Helkin');
  });

  it('stripSelfEchoRecipients preserves broadcast All', () => {
    expect(stripSelfEchoRecipients('Benjamin', 'All')).toBe('All');
  });
});

describe('CanonicalChatroomPayloadSchema', () => {
  it('accepts valid payload', () => {
    const ok = CanonicalChatroomPayloadSchema.safeParse({
      messageType: 'analysis',
      content: 'x',
      confidence: 50,
      sender: 'Lucas',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects missing sender', () => {
    const ok = CanonicalChatroomPayloadSchema.safeParse({
      messageType: 'analysis',
      content: 'x',
      confidence: 50,
    });
    expect(ok.success).toBe(false);
  });

  it('rejects non-integer confidence', () => {
    const ok = CanonicalChatroomPayloadSchema.safeParse({
      messageType: 'analysis',
      content: 'x',
      confidence: 50.5,
      sender: 'Lucas',
    });
    expect(ok.success).toBe(false);
  });
});

describe('ChatroomMessageSchema — canonical fields (#673)', () => {
  it('accepts a message with canonical envelope fields', () => {
    const ok = ChatroomMessageSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001',
      from: 'Benjamin',
      to: 'Helkin',
      content: 'findings',
      contentType: 'partial_result',
      timestamp: Date.now(),
      correlationId: 'corr-1',
      messageType: 'contribution',
      confidence: 85,
      sender: 'Benjamin',
    });
    expect(ok.success).toBe(true);
  });

  it('preserves backwards compat — canonical fields remain optional', () => {
    const ok = ChatroomMessageSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000002',
      from: 'Benjamin',
      to: 'Helkin',
      content: 'legacy text',
      contentType: 'text',
      timestamp: Date.now(),
      correlationId: 'corr-1',
    });
    expect(ok.success).toBe(true);
  });
});
