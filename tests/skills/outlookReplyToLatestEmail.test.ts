import { afterEach, describe, expect, it, vi } from 'vitest';

describe('outlook_reply_to_latest_email handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env['AZURE_CONTENT_SAFETY_ENDPOINT'];
    delete process.env['AZURE_CONTENT_SAFETY_KEY'];
  });

  it('finds the latest email from a sender and replies in-thread', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              id: 'msg-123',
              subject: 'Test subject',
              from: { emailAddress: { address: 'eric@eanderson.de', name: 'Eric' } },
              receivedDateTime: '2026-03-28T10:00:00Z',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      });

    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await import('../../skills/outlook/handlers.js');
    const result = await handlers['outlook_reply_to_latest_email']({
      userId: 'user-1',
      sender: 'eric@eanderson.de',
      comment: 'Thanks — confirming the test email path works.',
      _scopedToken: 'scoped-test-token',
      correlationId: 'corr-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/me/messages?$search=');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/me/messages/msg-123/reply');
    expect(result).toMatchObject({
      success: true,
      sender: 'eric@eanderson.de',
      subject: 'Test subject',
      action: 'reply',
    });
    expect(result).not.toHaveProperty('repliedToMessageId');
  });
});