import { describe, expect, it } from 'vitest';
import {
  clearPendingLinkChallenge,
  getPendingLinkChallengeForReply,
  getPendingLinkChallengeForUser,
  registerPendingLinkChallenge,
} from '../../src/auth/pendingLinkChallengeStore.js';

describe('pendingLinkChallengeStore', () => {
  it('returns the active challenge only for the matching user and quoted reply target', () => {
    const nowMs = 1_000;
    registerPendingLinkChallenge({
      userId: 'user-a',
      skillDomain: 'outlook',
      connectionName: 'GraphOAuth',
      replyToActivityId: 'activity-123',
    }, nowMs);

    expect(getPendingLinkChallengeForReply('user-a', 'activity-123', nowMs + 1_000)).toMatchObject({
      skillDomain: 'outlook',
      connectionName: 'GraphOAuth',
      replyToActivityId: 'activity-123',
    });
    expect(getPendingLinkChallengeForReply('user-a', 'activity-999', nowMs + 1_000)).toBeUndefined();
    expect(getPendingLinkChallengeForReply('user-b', 'activity-123', nowMs + 1_000)).toBeUndefined();

    clearPendingLinkChallenge('user-a');
  });

  it('expires old challenges automatically', () => {
    const nowMs = 5_000;
    registerPendingLinkChallenge({
      userId: 'user-expire',
      skillDomain: 'outlook',
      connectionName: 'GraphOAuth',
      replyToActivityId: 'activity-expire',
    }, nowMs);

    expect(getPendingLinkChallengeForReply('user-expire', 'activity-expire', nowMs + (10 * 60 * 1000) + 1)).toBeUndefined();
  });

  it('getPendingLinkChallengeForUser returns challenge regardless of replyToId', () => {
    const nowMs = 10_000;
    registerPendingLinkChallenge({
      userId: 'user-fallback',
      skillDomain: 'outlook',
      connectionName: 'GraphOAuth',
      replyToActivityId: 'activity-original',
    }, nowMs);

    // Strict match fails for wrong replyToId
    expect(getPendingLinkChallengeForReply('user-fallback', 'activity-wrong', nowMs + 1_000)).toBeUndefined();

    // Fallback returns the challenge regardless
    expect(getPendingLinkChallengeForUser('user-fallback', nowMs + 1_000)).toMatchObject({
      skillDomain: 'outlook',
      replyToActivityId: 'activity-original',
    });

    // Unknown user returns undefined
    expect(getPendingLinkChallengeForUser('user-unknown', nowMs + 1_000)).toBeUndefined();

    // Expired challenge returns undefined
    expect(getPendingLinkChallengeForUser('user-fallback', nowMs + (10 * 60 * 1000) + 1)).toBeUndefined();

    clearPendingLinkChallenge('user-fallback');
  });
});