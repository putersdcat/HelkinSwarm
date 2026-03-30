import { afterEach, describe, expect, it, vi } from 'vitest';

describe('outlook_create_calendar_event handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env['AZURE_CONTENT_SAFETY_ENDPOINT'];
    delete process.env['AZURE_CONTENT_SAFETY_KEY'];
  });

  it('returns a human-facing success payload without the raw backend event id', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'evt-opaque-backend-id',
        subject: 'Lunch with a friend',
        start: { dateTime: '2026-03-31T12:30:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-03-31T13:30:00Z', timeZone: 'UTC' },
        attendees: [
          { emailAddress: { address: 'friend@example.com' } },
        ],
        isReminderOn: true,
        reminderMinutesBeforeStart: 15,
        onlineMeetingUrl: null,
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await import('../../skills/outlook/handlers.js');
    const result = await handlers['outlook_create_calendar_event']({
      userId: 'user-1',
      subject: 'Lunch with a friend',
      start: '2026-03-31T12:30:00Z',
      end: '2026-03-31T13:30:00Z',
      attendees: ['friend@example.com'],
      reminderMinutesBeforeStart: 15,
      isReminderOn: true,
      _scopedToken: 'scoped-test-token',
      correlationId: 'corr-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/me/events');
    expect(result).toMatchObject({
      subject: 'Lunch with a friend',
      start: '2026-03-31T12:30:00Z',
      end: '2026-03-31T13:30:00Z',
      attendees: ['friend@example.com'],
      isReminderOn: true,
      reminderMinutesBeforeStart: 15,
      meetingUrl: null,
    });
    expect(result).not.toHaveProperty('id');
  });
});