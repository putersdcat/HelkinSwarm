import { describe, expect, it } from 'vitest';
import { buildStartupNoticeMessage } from '../../src/bot/lifecycleNotices.js';

describe('buildStartupNoticeMessage', () => {
  it('warns that inbound Teams delivery is not yet proven on a fresh runtime', () => {
    const message = buildStartupNoticeMessage('2026-03-30T20:00:39.494Z');

    expect(message).toContain('🟢 **HelkinSwarm Runtime Online**');
    expect(message).toContain('Started: 2026-03-30T20:00:39.494Z');
    expect(message).toContain('Inbound Teams delivery is still being verified on this fresh runtime.');
    expect(message).toContain('If your next message gets no reply within about a minute, resend it.');
  });
});