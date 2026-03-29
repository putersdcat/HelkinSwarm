import { describe, expect, it } from 'vitest';
import {
  clearPendingLinkChallenge,
  getPendingLinkChallengeForReply,
  getPendingLinkChallengeForUser,
  registerPendingLinkChallenge,
} from '../../src/auth/pendingLinkChallengeStore.js';

describe('pendingLinkChallengeStore', () => {
  it('returns the active challenge only for the matching user and quoted reply target', async () => {
    const nowMs = 1_000;
    await registerPendingLinkChallenge({
      userId: 'user-a',
      skillDomain: 'outlook',
      connectionName: 'GraphOAuth',
      replyToActivityId: 'activity-123',
      channelUserId: '29:user-a',
      channelId: 'msteams',
    }, nowMs);

    await expect(getPendingLinkChallengeForReply('user-a', 'activity-123', nowMs + 1_000)).resolves.toMatchObject({
      skillDomain: 'outlook',
      connectionName: 'GraphOAuth',
      replyToActivityId: 'activity-123',
      channelUserId: '29:user-a',
      channelId: 'msteams',
    });
    await expect(getPendingLinkChallengeForReply('user-a', 'activity-999', nowMs + 1_000)).resolves.toBeUndefined();
    await expect(getPendingLinkChallengeForReply('user-b', 'activity-123', nowMs + 1_000)).resolves.toBeUndefined();

    await clearPendingLinkChallenge('user-a');
  });

  it('expires old challenges automatically', async () => {
    const nowMs = 5_000;
    await registerPendingLinkChallenge({
      userId: 'user-expire',
      skillDomain: 'outlook',
      connectionName: 'GraphOAuth',
      replyToActivityId: 'activity-expire',
      channelUserId: '29:user-expire',
      channelId: 'msteams',
    }, nowMs);

    await expect(getPendingLinkChallengeForReply('user-expire', 'activity-expire', nowMs + (10 * 60 * 1000) + 1)).resolves.toBeUndefined();
  });

  it('getPendingLinkChallengeForUser returns challenge regardless of replyToId', async () => {
    const nowMs = 10_000;
    await registerPendingLinkChallenge({
      userId: 'user-fallback',
      skillDomain: 'outlook',
      connectionName: 'GraphOAuth',
      replyToActivityId: 'activity-original',
      channelUserId: '29:user-fallback',
      channelId: 'msteams',
    }, nowMs);

    // Strict match fails for wrong replyToId
    await expect(getPendingLinkChallengeForReply('user-fallback', 'activity-wrong', nowMs + 1_000)).resolves.toBeUndefined();

    // Fallback returns the challenge regardless
    await expect(getPendingLinkChallengeForUser('user-fallback', nowMs + 1_000)).resolves.toMatchObject({
      skillDomain: 'outlook',
      replyToActivityId: 'activity-original',
      channelUserId: '29:user-fallback',
      channelId: 'msteams',
    });

    // Unknown user returns undefined
    await expect(getPendingLinkChallengeForUser('user-unknown', nowMs + 1_000)).resolves.toBeUndefined();

    // Expired challenge returns undefined
    await expect(getPendingLinkChallengeForUser('user-fallback', nowMs + (10 * 60 * 1000) + 1)).resolves.toBeUndefined();

    await clearPendingLinkChallenge('user-fallback');
  });
});