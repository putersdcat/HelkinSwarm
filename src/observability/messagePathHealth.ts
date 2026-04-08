// Message-path health tracker — local pending-turn signal plus shared
// cross-instance success/failure timestamps persisted in AzureWebJobsStorage.
// Helps /api/health report recent webhook/turn failures without getting stuck
// on a stale failure from another worker instance.

import { BlobServiceClient, RestError } from '@azure/storage-blob';

export type MessagePathStatus = 'ok' | 'degraded' | 'error';

export interface MessagePathSnapshot {
  status: MessagePathStatus;
  pendingTurns: number;
  oldestPendingAgeMs: number | null;
  lastAcceptedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

interface PendingTurn {
  startedAtMs: number;
}

interface SharedMessagePathEventRecord {
  timestampMs: number;
  reason?: string;
}

interface SharedMessagePathState {
  lastAcceptedAtMs: number | null;
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
  lastFailureReason: string | null;
}

const pendingTurns = new Map<string, PendingTurn>();

let lastAcceptedAtMs: number | null = null;
let lastSuccessAtMs: number | null = null;
let lastFailureAtMs: number | null = null;
let lastFailureReason: string | null = null;

const STUCK_TURN_THRESHOLD_MS = 30_000;
const RECENT_FAILURE_WINDOW_MS = 10 * 60_000;
const SHARED_STATE_CONTAINER = 'helkinswarm-health';
const SHARED_STATE_CACHE_TTL_MS = 2_000;

let blobServiceClient: BlobServiceClient | undefined;
let containerInitPromise: Promise<void> | undefined;

const sharedStateCache: Record<'accepted' | 'success' | 'failure', { value?: SharedMessagePathEventRecord; loadedAtMs: number }> = {
  accepted: { loadedAtMs: 0 },
  success: { loadedAtMs: 0 },
  failure: { loadedAtMs: 0 },
};

export function recordMessagePathStart(turnId: string, startedAtMs = Date.now()): void {
  pendingTurns.set(turnId, { startedAtMs });
}

export async function recordMessagePathAccepted(
  turnId: string,
  acceptedAtMs = Date.now(),
): Promise<void> {
  pendingTurns.delete(turnId);
  lastAcceptedAtMs = acceptedAtMs;

  await persistSharedEvent('accepted', { timestampMs: acceptedAtMs });
}

export async function recordMessagePathSuccess(
  turnId: string,
  completedAtMs = Date.now(),
): Promise<void> {
  pendingTurns.delete(turnId);
  lastSuccessAtMs = completedAtMs;

  if (lastFailureAtMs !== null && completedAtMs >= lastFailureAtMs) {
    lastFailureAtMs = null;
    lastFailureReason = null;
  }

  await persistSharedEvent('success', { timestampMs: completedAtMs });
}

export async function recordMessagePathFailure(
  turnId: string,
  reason: string,
  failedAtMs = Date.now(),
): Promise<void> {
  pendingTurns.delete(turnId);
  lastFailureAtMs = failedAtMs;
  lastFailureReason = reason;

  await persistSharedEvent('failure', { timestampMs: failedAtMs, reason });
}

export async function recordMessagePathGlobalFailure(
  reason: string,
  failedAtMs = Date.now(),
): Promise<void> {
  lastFailureAtMs = failedAtMs;
  lastFailureReason = reason;

  await persistSharedEvent('failure', { timestampMs: failedAtMs, reason });
}

export function buildMessagePathSnapshot(input: {
  nowMs: number;
  pendingTurns: number;
  oldestPendingAgeMs: number | null;
  localLastAcceptedAtMs: number | null;
  localLastSuccessAtMs: number | null;
  localLastFailureAtMs: number | null;
  localLastFailureReason: string | null;
  sharedLastAcceptedAtMs: number | null;
  sharedLastSuccessAtMs: number | null;
  sharedLastFailureAtMs: number | null;
  sharedLastFailureReason: string | null;
}): MessagePathSnapshot {
  const effectiveLastAcceptedAtMs = maxNullable(input.localLastAcceptedAtMs, input.sharedLastAcceptedAtMs);
  const effectiveLastSuccessAtMs = maxNullable(input.localLastSuccessAtMs, input.sharedLastSuccessAtMs);
  const latestFailureSource =
    (input.sharedLastFailureAtMs ?? Number.NEGATIVE_INFINITY) >=
    (input.localLastFailureAtMs ?? Number.NEGATIVE_INFINITY)
      ? 'shared'
      : 'local';
  const effectiveLastFailureAtMs = maxNullable(input.localLastFailureAtMs, input.sharedLastFailureAtMs);
  const effectiveLastFailureReason = latestFailureSource === 'shared'
    ? input.sharedLastFailureReason
    : input.localLastFailureReason;

  const hasStuckTurn =
    input.oldestPendingAgeMs !== null && input.oldestPendingAgeMs >= STUCK_TURN_THRESHOLD_MS;
  const failureIsCleared =
    effectiveLastFailureAtMs !== null &&
    effectiveLastSuccessAtMs !== null &&
    effectiveLastSuccessAtMs >= effectiveLastFailureAtMs;

  const visibleLastFailureAtMs = failureIsCleared ? null : effectiveLastFailureAtMs;
  const visibleLastFailureReason = failureIsCleared ? null : effectiveLastFailureReason;

  const hasRecentFailure =
    visibleLastFailureAtMs !== null &&
    input.nowMs - visibleLastFailureAtMs <= RECENT_FAILURE_WINDOW_MS;

  const status: MessagePathStatus = hasStuckTurn
    ? 'error'
    : hasRecentFailure
      ? 'degraded'
      : 'ok';

  return {
    status,
    pendingTurns: input.pendingTurns,
    oldestPendingAgeMs: input.oldestPendingAgeMs,
    lastAcceptedAt: effectiveLastAcceptedAtMs === null ? null : new Date(effectiveLastAcceptedAtMs).toISOString(),
    lastSuccessAt: effectiveLastSuccessAtMs === null ? null : new Date(effectiveLastSuccessAtMs).toISOString(),
    lastFailureAt: visibleLastFailureAtMs === null ? null : new Date(visibleLastFailureAtMs).toISOString(),
    lastFailureReason: visibleLastFailureReason,
  };
}

export async function getMessagePathSnapshot(nowMs = Date.now()): Promise<MessagePathSnapshot> {
  let oldestPendingAgeMs: number | null = null;
  for (const pending of pendingTurns.values()) {
    const age = nowMs - pending.startedAtMs;
    if (oldestPendingAgeMs === null || age > oldestPendingAgeMs) {
      oldestPendingAgeMs = age;
    }
  }

  const sharedState = await loadSharedState();

  return buildMessagePathSnapshot({
    nowMs,
    pendingTurns: pendingTurns.size,
    oldestPendingAgeMs,
    localLastAcceptedAtMs: lastAcceptedAtMs,
    localLastSuccessAtMs: lastSuccessAtMs,
    localLastFailureAtMs: lastFailureAtMs,
    localLastFailureReason: lastFailureReason,
    sharedLastAcceptedAtMs: sharedState.lastAcceptedAtMs,
    sharedLastSuccessAtMs: sharedState.lastSuccessAtMs,
    sharedLastFailureAtMs: sharedState.lastFailureAtMs,
    sharedLastFailureReason: sharedState.lastFailureReason,
  });
}

export function resetMessagePathHealth(): void {
  pendingTurns.clear();
  lastAcceptedAtMs = null;
  lastSuccessAtMs = null;
  lastFailureAtMs = null;
  lastFailureReason = null;
  sharedStateCache.accepted = { loadedAtMs: 0 };
  sharedStateCache.success = { loadedAtMs: 0 };
  sharedStateCache.failure = { loadedAtMs: 0 };
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function getBlobServiceClient(): BlobServiceClient | undefined {
  if (blobServiceClient) {
    return blobServiceClient;
  }

  const connectionString = process.env['AzureWebJobsStorage'] ?? process.env['AZUREWEBJOBSSTORAGE'];
  if (!connectionString) {
    return undefined;
  }

  blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient;
}

async function ensureContainer(): Promise<boolean> {
  const serviceClient = getBlobServiceClient();
  if (!serviceClient) {
    return false;
  }

  if (!containerInitPromise) {
    containerInitPromise = serviceClient
      .getContainerClient(SHARED_STATE_CONTAINER)
      .createIfNotExists()
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn('[messagePathHealth] Failed to initialize shared state container:', error);
        containerInitPromise = undefined;
      });
  }

  await containerInitPromise;
  return true;
}

function getScopeKey(): string {
  const raw =
    process.env['WEBSITE_SITE_NAME'] ??
    process.env['WEBSITE_HOSTNAME'] ??
    process.env['HOSTNAME'] ??
    'local-dev';

  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

async function persistSharedEvent(
  kind: 'accepted' | 'success' | 'failure',
  record: SharedMessagePathEventRecord,
): Promise<void> {
  const containerReady = await ensureContainer();
  if (!containerReady) {
    return;
  }

  try {
    const blobClient = getBlobServiceClient()!
      .getContainerClient(SHARED_STATE_CONTAINER)
      .getBlockBlobClient(`message-path/${getScopeKey()}/${kind}.json`);

    await blobClient.upload(
      JSON.stringify(record),
      Buffer.byteLength(JSON.stringify(record)),
      {
        blobHTTPHeaders: { blobContentType: 'application/json' },
      },
    );

    sharedStateCache[kind] = { value: record, loadedAtMs: Date.now() };
  } catch (error: unknown) {
    console.warn(`[messagePathHealth] Failed to persist shared ${kind} event:`, error);
  }
}

async function loadSharedState(): Promise<SharedMessagePathState> {
  const [accepted, success, failure] = await Promise.all([
    loadSharedEvent('accepted'),
    loadSharedEvent('success'),
    loadSharedEvent('failure'),
  ]);

  return {
    lastAcceptedAtMs: accepted?.timestampMs ?? null,
    lastSuccessAtMs: success?.timestampMs ?? null,
    lastFailureAtMs: failure?.timestampMs ?? null,
    lastFailureReason: failure?.reason ?? null,
  };
}

async function loadSharedEvent(
  kind: 'accepted' | 'success' | 'failure',
): Promise<SharedMessagePathEventRecord | undefined> {
  const cached = sharedStateCache[kind];
  const now = Date.now();
  if (cached.value && now - cached.loadedAtMs < SHARED_STATE_CACHE_TTL_MS) {
    return cached.value;
  }

  const containerReady = await ensureContainer();
  if (!containerReady) {
    return undefined;
  }

  try {
    const blobClient = getBlobServiceClient()!
      .getContainerClient(SHARED_STATE_CONTAINER)
      .getBlockBlobClient(`message-path/${getScopeKey()}/${kind}.json`);

    const response = await blobClient.download();
    const content = await streamToString(response.readableStreamBody);
    const parsed = JSON.parse(content) as SharedMessagePathEventRecord;
    sharedStateCache[kind] = { value: parsed, loadedAtMs: now };
    return parsed;
  } catch (error: unknown) {
    if (error instanceof RestError && error.statusCode === 404) {
      sharedStateCache[kind] = { loadedAtMs: now };
      return undefined;
    }
    console.warn(`[messagePathHealth] Failed to load shared ${kind} event:`, error);
    return undefined;
  }
}

async function streamToString(
  stream: NodeJS.ReadableStream | undefined,
): Promise<string> {
  if (!stream) {
    return '';
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf-8');
}