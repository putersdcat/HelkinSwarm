export interface PendingLinkChallenge {
  userId: string;
  skillDomain: string;
  connectionName: string;
  replyToActivityId: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface RegisterPendingLinkChallengeInput {
  userId: string;
  skillDomain: string;
  connectionName: string;
  replyToActivityId: string;
}

const PENDING_LINK_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const challengesByUser = new Map<string, PendingLinkChallenge>();

function pruneExpiredChallenges(nowMs: number): void {
  for (const [userId, challenge] of challengesByUser) {
    if (challenge.expiresAtMs <= nowMs) {
      challengesByUser.delete(userId);
    }
  }
}

export function registerPendingLinkChallenge(
  input: RegisterPendingLinkChallengeInput,
  nowMs = Date.now(),
): PendingLinkChallenge {
  pruneExpiredChallenges(nowMs);

  const challenge: PendingLinkChallenge = {
    ...input,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + PENDING_LINK_CHALLENGE_TTL_MS,
  };

  challengesByUser.set(input.userId, challenge);
  console.info(
    `[pendingLinkChallengeStore] Registered challenge: userId=${input.userId} ` +
    `skill=${input.skillDomain} replyToActivityId=${input.replyToActivityId}`,
  );
  return challenge;
}

export function getPendingLinkChallengeForReply(
  userId: string,
  replyToActivityId: string | undefined,
  nowMs = Date.now(),
): PendingLinkChallenge | undefined {
  pruneExpiredChallenges(nowMs);

  if (!replyToActivityId) {
    return undefined;
  }

  const challenge = challengesByUser.get(userId);
  if (!challenge) {
    return undefined;
  }

  if (challenge.replyToActivityId !== replyToActivityId) {
    console.info(
      `[pendingLinkChallengeStore] replyToId mismatch for userId=${userId}: ` +
      `expected=${challenge.replyToActivityId} got=${replyToActivityId}`,
    );
    return undefined;
  }

  return challenge;
}

/**
 * Get any pending link challenge for a user, ignoring replyToId matching.
 * Used as a fallback when the message looks like an auth code but the strict
 * replyToId match fails (e.g., due to cross-container delivery or Teams message
 * ID format differences).
 */
export function getPendingLinkChallengeForUser(
  userId: string,
  nowMs = Date.now(),
): PendingLinkChallenge | undefined {
  pruneExpiredChallenges(nowMs);
  return challengesByUser.get(userId);
}

export function clearPendingLinkChallenge(userId: string): void {
  challengesByUser.delete(userId);
}