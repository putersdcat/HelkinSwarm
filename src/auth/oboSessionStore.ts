import { getContainer } from '../memory/cosmosClient.js';

const CONTAINER_NAME = 'msalTokenCache';
const DOC_PREFIX = 'obo-session-';

export interface OboSessionRecord {
  id: string;
  userId: string;
  type: 'obo-session';
  homeAccountId?: string;
  localAccountId?: string;
  username?: string;
  tenantId?: string;
  bootstrappedAt: string;
  updatedAt: string;
  lastCorrelationId?: string;
  source: 'teams-token-exchange';
}

function getDocId(userId: string): string {
  return `${DOC_PREFIX}${userId}`;
}

export async function loadOboSession(userId: string): Promise<OboSessionRecord | undefined> {
  const container = getContainer(CONTAINER_NAME);
  try {
    const { resource } = await container.item(getDocId(userId), userId).read<OboSessionRecord>();
    return resource ?? undefined;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function saveOboSession(
  userId: string,
  session: Omit<OboSessionRecord, 'id' | 'userId' | 'type' | 'updatedAt'>,
): Promise<OboSessionRecord> {
  const container = getContainer(CONTAINER_NAME);
  const record: OboSessionRecord = {
    id: getDocId(userId),
    userId,
    type: 'obo-session',
    updatedAt: new Date().toISOString(),
    ...session,
  };

  await container.items.upsert(record);
  return record;
}

export async function clearOboSession(userId: string): Promise<void> {
  const container = getContainer(CONTAINER_NAME);
  try {
    await container.item(getDocId(userId), userId).delete();
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
      return;
    }
    throw err;
  }
}