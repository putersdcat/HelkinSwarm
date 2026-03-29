export interface PendingLinkChallenge {
  userId: string;
  skillDomain: string;
  connectionName: string;
  replyToActivityId: string;
  conversationId: string;
  channelUserId?: string;
  channelId?: string;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface RegisterPendingLinkChallengeInput {
  userId: string;
  skillDomain: string;
  connectionName: string;
  replyToActivityId: string;
  conversationId?: string;
  channelUserId?: string;
  channelId?: string;
}

const PENDING_LINK_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const challengesByUser = new Map<string, PendingLinkChallenge>();
const CONTAINER_NAME = 'conversationReferences';

interface PendingLinkChallengeDocument extends PendingLinkChallenge {
  id: string;
}

function makePendingLinkChallengeDocumentId(userId: string): string {
  return `pending-link-${userId}`;
}

async function getChallengeContainer() {
  if (!process.env['COSMOS_ENDPOINT']) {
    return undefined;
  }
  const { getContainer } = await import('../memory/cosmosClient.js');
  return getContainer(CONTAINER_NAME);
}

async function saveChallengeDocument(challenge: PendingLinkChallenge): Promise<void> {
  try {
    const container = await getChallengeContainer();
    if (!container) {
      return;
    }
    const doc: PendingLinkChallengeDocument = {
      id: makePendingLinkChallengeDocumentId(challenge.userId),
      ...challenge,
    };
    await container.items.upsert(doc);
  } catch (err) {
    console.warn(
      `[pendingLinkChallengeStore] Failed to persist challenge for userId=${challenge.userId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function loadChallengeDocument(userId: string): Promise<PendingLinkChallenge | undefined> {
  try {
    const container = await getChallengeContainer();
    if (!container) {
      return undefined;
    }
    const { resources } = await container.items
      .query<PendingLinkChallengeDocument>({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: makePendingLinkChallengeDocumentId(userId) }],
      })
      .fetchAll();

    const doc = resources[0];
    if (!doc) {
      return undefined;
    }

    const { id: _id, ...challenge } = doc;
    return challenge;
  } catch (err) {
    console.warn(
      `[pendingLinkChallengeStore] Failed to load challenge for userId=${userId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

async function deleteChallengeDocument(userId: string, conversationId: string): Promise<void> {
  try {
    const container = await getChallengeContainer();
    if (!container) {
      return;
    }
    await container.item(makePendingLinkChallengeDocumentId(userId), conversationId).delete();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('404')) {
      console.warn(
        `[pendingLinkChallengeStore] Failed to delete challenge for userId=${userId}: ${message}`,
      );
    }
  }
}

function pruneExpiredChallenges(nowMs: number): void {
  for (const [userId, challenge] of challengesByUser) {
    if (challenge.expiresAtMs <= nowMs) {
      challengesByUser.delete(userId);
    }
  }
}

async function clearExpiredPersistedChallenge(
  challenge: PendingLinkChallenge | undefined,
  nowMs: number,
): Promise<PendingLinkChallenge | undefined> {
  if (!challenge) {
    return undefined;
  }

  if (challenge.expiresAtMs > nowMs) {
    return challenge;
  }

  challengesByUser.delete(challenge.userId);
  await deleteChallengeDocument(challenge.userId, challenge.conversationId);
  return undefined;
}

export async function registerPendingLinkChallenge(
  input: RegisterPendingLinkChallengeInput,
  nowMs = Date.now(),
): Promise<PendingLinkChallenge> {
  pruneExpiredChallenges(nowMs);

  const challenge: PendingLinkChallenge = {
    ...input,
    conversationId: input.conversationId ?? input.userId,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + PENDING_LINK_CHALLENGE_TTL_MS,
  };

  challengesByUser.set(input.userId, challenge);
  await saveChallengeDocument(challenge);
  console.info(
    `[pendingLinkChallengeStore] Registered challenge: userId=${input.userId} ` +
    `skill=${input.skillDomain} replyToActivityId=${input.replyToActivityId}`,
  );
  return challenge;
}

export async function getPendingLinkChallengeForReply(
  userId: string,
  replyToActivityId: string | undefined,
  nowMs = Date.now(),
): Promise<PendingLinkChallenge | undefined> {
  pruneExpiredChallenges(nowMs);

  if (!replyToActivityId) {
    return undefined;
  }

  let challenge = challengesByUser.get(userId);
  if (!challenge) {
    challenge = await loadChallengeDocument(userId);
    if (challenge) {
      challengesByUser.set(userId, challenge);
    }
  }
  challenge = await clearExpiredPersistedChallenge(challenge, nowMs);
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
export async function getPendingLinkChallengeForUser(
  userId: string,
  nowMs = Date.now(),
): Promise<PendingLinkChallenge | undefined> {
  pruneExpiredChallenges(nowMs);
  let challenge = challengesByUser.get(userId);
  if (!challenge) {
    challenge = await loadChallengeDocument(userId);
    if (challenge) {
      challengesByUser.set(userId, challenge);
    }
  }
  return clearExpiredPersistedChallenge(challenge, nowMs);
}

export async function clearPendingLinkChallenge(userId: string): Promise<void> {
  const existing = challengesByUser.get(userId) ?? await loadChallengeDocument(userId);
  challengesByUser.delete(userId);
  if (existing) {
    await deleteChallengeDocument(userId, existing.conversationId);
  }
}