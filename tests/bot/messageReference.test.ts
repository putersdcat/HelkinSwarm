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