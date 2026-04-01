import { afterEach, describe, expect, it, vi } from 'vitest';

describe('outlook_search_emails handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env['AZURE_CONTENT_SAFETY_ENDPOINT'];
    delete process.env['AZURE_CONTENT_SAFETY_KEY'];
  });

  it('falls back to recent Sent Items scanning when Graph search returns no recipient matches', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              id: 'sent-1',
              subject: 'Attachment proof',
              bodyPreview: 'See attached image.',
              from: { emailAddress: { address: 'owner@example.com', name: 'Owner' } },
              toRecipients: [{ emailAddress: { address: 'eric@eanderson.de' } }],
              ccRecipients: [],
              receivedDateTime: '2026-04-01T15:00:00Z',
              isRead: true,
              hasAttachments: true,
            },
            {
              id: 'sent-2',
              subject: 'Other message',
              bodyPreview: 'Nothing relevant here.',
              from: { emailAddress: { address: 'owner@example.com', name: 'Owner' } },
              toRecipients: [{ emailAddress: { address: 'someone@example.com' } }],
              ccRecipients: [],
              receivedDateTime: '2026-04-01T14:00:00Z',
              isRead: true,
              hasAttachments: false,
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await import('../../skills/outlook/handlers.js');
    const result = await handlers['outlook_search_emails']({
      userId: 'user-1',
      folder: 'sentitems',
      query: 'eric@eanderson.de hasAttachment:true',
      top: 5,
      _scopedToken: 'scoped-test-token',
      correlationId: 'corr-sent-search',
    }) as Array<{ id: string; subject: string; hasAttachments?: boolean }>;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/me/mailFolders/sentitems/messages?$search=');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/me/mailFolders/sentitems/messages?$top=50');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('toRecipients,ccRecipients');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'sent-1',
        subject: 'Attachment proof',
        hasAttachments: true,
      }),
    ]);
  });

  it('falls back to recent mailbox scanning for sender queries when Graph search returns no inbox matches', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              id: 'inbox-1',
              subject: 'Actual inbox hit',
              bodyPreview: 'The sender match is here.',
              from: { emailAddress: { address: 'eric@eanderson.de', name: 'Eric Anderson' } },
              toRecipients: [{ emailAddress: { address: 'owner@example.com' } }],
              ccRecipients: [],
              receivedDateTime: '2026-04-01T16:00:00Z',
              isRead: false,
              hasAttachments: false,
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await import('../../skills/outlook/handlers.js');
    const result = await handlers['outlook_search_emails']({
      userId: 'user-1',
      query: 'from:eric@eanderson.de',
      top: 5,
      _scopedToken: 'scoped-test-token',
      correlationId: 'corr-inbox-search',
    }) as Array<{ id: string; from: string }>;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/me/messages?$top=50');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'inbox-1',
        from: 'eric@eanderson.de',
      }),
    ]);
  });
});