import { afterEach, describe, expect, it, vi } from 'vitest';

describe('outlook_send_email inline-image guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('rejects unsupported cid-based inline image HTML instead of sending a broken email', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await import('../../skills/outlook/handlers.js');

    await expect(
      handlers['outlook_send_email']({
        userId: 'user-1',
        to: ['eric@example.com'],
        subject: 'Inline image attempt',
        bodyType: 'html',
        body: '<p>Hello</p><img src="cid:robotlove" />',
        _scopedToken: 'scoped-test-token',
        correlationId: 'corr-inline-guard',
      }),
    ).rejects.toThrow(/Embedded inline images in outgoing Outlook email are not supported yet/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});