import { describe, expect, it } from 'vitest';
import { buildOverseerDedupIdentity } from '../../src/bot/overseerDedupIdentity.js';

describe('overseerDedupIdentity', () => {
  it('uses the Teams activity id to distinguish repeated short replies with the same text', () => {
    const first = buildOverseerDedupIdentity({
      userId: 'user-1',
      userMessage: 'cancel',
      messageId: 'activity-1',
      timeBucket: 123,
    });

    const second = buildOverseerDedupIdentity({
      userId: 'user-1',
      userMessage: 'cancel',
      messageId: 'activity-2',
      timeBucket: 123,
    });

    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.previousInstanceId).not.toBe(second.previousInstanceId);
  });

  it('keeps exact duplicate deliveries stable when the same activity id is retried', () => {
    const first = buildOverseerDedupIdentity({
      userId: 'user-1',
      userMessage: 'cancel',
      messageId: 'activity-quoted-cancel',
      modelOverride: 'primary',
      timeBucket: 456,
    });

    const second = buildOverseerDedupIdentity({
      userId: 'user-1',
      userMessage: 'cancel',
      messageId: 'activity-quoted-cancel',
      modelOverride: 'primary',
      timeBucket: 456,
    });

    expect(first.instanceId).toBe(second.instanceId);
    expect(first.previousInstanceId).toBe(second.previousInstanceId);
  });

  it('falls back to message text when no activity id is available', () => {
    const first = buildOverseerDedupIdentity({
      userId: 'user-1',
      userMessage: 'cancel',
      timeBucket: 789,
    });

    const second = buildOverseerDedupIdentity({
      userId: 'user-1',
      userMessage: 'cancel',
      timeBucket: 789,
    });

    expect(first.instanceId).toBe(second.instanceId);
    expect(first.previousInstanceId).toBe(second.previousInstanceId);
  });
});
