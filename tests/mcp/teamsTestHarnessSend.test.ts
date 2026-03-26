import { describe, expect, it } from 'vitest';
import { buildQuotedReplyRequest } from '../../src/mcp/teamsTestHarnessSend.js';

describe('teamsTestHarnessSend helpers', () => {
  it('builds a Graph replyWithQuote request body', () => {
    const request = buildQuotedReplyRequest({
      targetMessageId: '1774559548552',
      message: '161948',
      quotedPreview: '📄',
    });

    expect(request).toEqual({
      messageIds: ['1774559548552'],
      replyMessage: {
        body: {
          contentType: 'text',
          content: '161948',
        },
      },
    });
  });

  it('preserves plain text content verbatim for the reply body', () => {
    const request = buildQuotedReplyRequest({
      targetMessageId: 'msg-1',
      message: '<tag> & "quote"',
    });

    expect(request.replyMessage.body.content).toBe('<tag> & "quote"');
  });
});