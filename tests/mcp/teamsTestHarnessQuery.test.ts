import { describe, expect, it } from 'vitest';
import {
  getHarnessMessageWindow,
  normalizeHarnessMessage,
  queryHarnessMessages,
  type HarnessRawMessage,
} from '../../src/mcp/teamsTestHarnessQuery.js';

const messages: HarnessRawMessage[] = [
  {
    id: 'm1',
    createdDateTime: '2026-03-26T07:00:00.000Z',
    from: { user: { displayName: 'Eric', id: 'u1' } },
    body: { content: 'DEVLOOP: [DL-20260326070000-AAAA] hello OVER', contentType: 'text' },
  },
  {
    id: 'm2',
    createdDateTime: '2026-03-26T07:00:02.000Z',
    from: { application: { displayName: 'HelkinSwarm', id: 'bot1' } },
    body: { content: 'SWARM: hi there [DL-20260326070000-AAAA] OVER', contentType: 'html' },
  },
  {
    id: 'm3',
    createdDateTime: '2026-03-26T07:00:05.000Z',
    from: { user: { displayName: 'Eric', id: 'u1' } },
    body: { content: 'show me the telemetry footer corr:8b42c40e', contentType: 'text' },
  },
  {
    id: 'm4',
    createdDateTime: '2026-03-26T07:00:09.000Z',
    from: { application: { displayName: 'HelkinSwarm', id: 'bot1' } },
    body: { content: '<p>done</p><pre>tools: outlook_list_emails</pre>', contentType: 'html' },
  },
];

describe('teamsTestHarnessQuery helpers', () => {
  it('normalizes sender kind, html, and correlation matches', () => {
    const normalized = normalizeHarnessMessage(messages[1]!);

    expect(normalized.senderKind).toBe('bot');
    expect(normalized.text).toContain('SWARM: hi there');
    expect(normalized.correlationMatches).toContain('[DL-20260326070000-AAAA]');
  });

  it('filters by correlation and bot direction with last-match helper', () => {
    const results = queryHarnessMessages(messages, {
      correlation: 'DL-20260326070000-AAAA',
      direction: 'bot-to-human',
      pick: 'last',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('m2');
  });

  it('supports before/after message slicing and text matching', () => {
    const results = queryHarnessMessages(messages, {
      contains: 'telemetry footer',
      afterMessageId: 'm2',
      beforeMessageId: 'm4',
    });

    expect(results.map((message) => message.id)).toEqual(['m3']);
  });

  it('returns a focused window around a correlation anchor', () => {
    const result = getHarnessMessageWindow(messages, {
      aroundCorrelation: '8b42c40e',
      beforeCount: 1,
      afterCount: 1,
    });

    expect(result.anchor?.id).toBe('m3');
    expect(result.messages.map((message) => message.id)).toEqual(['m2', 'm3', 'm4']);
  });
});