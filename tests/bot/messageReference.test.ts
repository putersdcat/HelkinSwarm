import { describe, expect, it } from 'vitest';
import {
  extractMessageReferenceId,
  extractMessageReferencePreview,
} from '../../src/bot/messageReference.js';

describe('messageReference helpers', () => {
  it('extracts the referenced Teams message id from a messageReference attachment', () => {
    const attachments = [
      {
        contentType: 'messageReference',
        content: {
          messageId: '1774559548552',
          messagePreview: '📄',
        },
      },
    ];

    expect(extractMessageReferenceId(attachments)).toBe('1774559548552');
  });

  it('extracts the message preview from a messageReference attachment', () => {
    const attachments = [
      {
        contentType: 'messageReference',
        content: {
          messageId: '1774559548552',
          messagePreview: '📄',
        },
      },
    ];

    expect(extractMessageReferencePreview(attachments)).toBe('📄');
  });

  it('accepts Teams message-reference attachments that use a hyphenated content type', () => {
    const attachments = [
      {
        contentType: 'message-reference',
        content: {
          messageId: '1775343853560',
          messagePreview: 'Best matching tool: outlook_search_emails',
        },
      },
    ];

    expect(extractMessageReferenceId(attachments)).toBe('1775343853560');
    expect(extractMessageReferencePreview(attachments)).toBe('Best matching tool: outlook_search_emails');
  });

  it('falls back to cardPayload when Teams emits message-reference metadata there instead of content', () => {
    const attachments = [
      {
        contentType: 'message-reference',
        cardPayload: {
          messageId: '1775347257681',
          messagePreview: 'Microsoft Graph Enterprise MCP is installed but in operator-setup-required state.',
        },
      },
    ];

    expect(extractMessageReferenceId(attachments)).toBe('1775347257681');
    expect(extractMessageReferencePreview(attachments)).toBe('Microsoft Graph Enterprise MCP is installed but in operator-setup-required state.');
  });

  it('ignores unrelated attachments', () => {
    const attachments = [
      {
        contentType: 'application/vnd.microsoft.card.hero',
        content: {
          text: 'hello',
        },
      },
    ];

    expect(extractMessageReferenceId(attachments)).toBeUndefined();
    expect(extractMessageReferencePreview(attachments)).toBeUndefined();
  });
});