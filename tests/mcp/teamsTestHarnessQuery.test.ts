import { describe, expect, it } from 'vitest';
import {
  buildHarnessSessionBundle,
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
    attachments: [
      {
        id: 'a1',
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: JSON.stringify({
          type: 'AdaptiveCard',
          version: '1.5',
          body: [{ type: 'TextBlock', text: 'Link Microsoft Account' }],
          actions: [{ type: 'Action.OpenUrl', title: 'Open', url: 'https://example.test' }],
        }),
        name: 'oauth-card',
      },
      {
        id: 'a2',
        contentType: 'image/png',
        contentUrl: 'https://example.test/image.png',
        thumbnailUrl: 'https://example.test/thumb.png',
        name: 'thumb',
      },
    ],
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

  it('preserves formatting hints and structured card/image attachments', () => {
    const normalized = normalizeHarnessMessage(messages[3]!);

    expect(normalized.formatting.hasHtml).toBe(true);
    expect(normalized.formatting.hasCodeBlock).toBe(true);
    expect(normalized.attachments).toHaveLength(2);
    expect(normalized.cards).toHaveLength(1);
    expect(normalized.cards[0]?.kind).toBe('adaptive-card');
    expect(normalized.cards[0]?.cardPayload).toMatchObject({
      type: 'AdaptiveCard',
      body: [{ type: 'TextBlock', text: 'Link Microsoft Account' }],
    });
    expect(normalized.attachments[1]?.kind).toBe('image');
    expect(normalized.attachments[1]?.contentUrl).toBe('https://example.test/image.png');
  });

  it('recognizes messageReference attachments used by Teams quoted replies', () => {
    const normalized = normalizeHarnessMessage({
      id: 'm5',
      createdDateTime: '2026-03-26T07:00:10.000Z',
      from: { user: { displayName: 'Eric', id: 'u1' } },
      body: { content: '<attachment id="m4"></attachment><p>161948</p>', contentType: 'html' },
      attachments: [
        {
          id: 'm4',
          contentType: 'messageReference',
          content: JSON.stringify({ messageId: 'm4', messagePreview: '📄' }),
        },
      ],
    });

    expect(normalized.attachments[0]?.kind).toBe('message-reference');
    expect(normalized.attachments[0]?.cardPayload).toMatchObject({ messageId: 'm4', messagePreview: '📄' });
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

  it('can anchor a message window on card payload text', () => {
    const result = getHarnessMessageWindow(messages, {
      aroundContains: 'Link Microsoft Account',
      beforeCount: 0,
      afterCount: 0,
    });

    expect(result.anchor?.id).toBe('m4');
    expect(result.messages.map((message) => message.id)).toEqual(['m4']);
  });

  it('builds a structured session bundle summary', () => {
    const bundle = buildHarnessSessionBundle(messages, {
      correlation: '8b42c40e',
      beforeCount: 1,
      afterCount: 1,
    });

    expect(bundle.anchor?.id).toBe('m3');
    expect(bundle.messages.map((message) => message.id)).toEqual(['m2', 'm3', 'm4']);
    expect(bundle.timing.elapsedMs).toBe(7000);
    expect(bundle.participants).toHaveLength(2);
    expect(bundle.confirmationDetected).toBe(true);
    expect(bundle.cards[0]).toMatchObject({
      messageId: 'm4',
      kind: 'adaptive-card',
    });
  });
});