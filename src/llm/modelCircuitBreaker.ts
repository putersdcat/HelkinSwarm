// Model circuit breaker — tracks degraded models and skips them during fallback.
// Local state remains in-memory, but we also mirror it to shared blob storage so
// owner-side proof injection and LLM workers can see the same degradation state.

import { BlobServiceClient, RestError } from '@azure/storage-blob';

export interface DegradedModel {
  deploymentName: string;
  degradedAt: number;
  reason: string;
  failureCount: number;
  cooldownMs: number; // differentiated by error type (#313)
}

const DEFAULT_COOLDOWN_MS = 60_000; // 60 seconds
const SHARED_STATE_CONTAINER = 'helkinswarm-health';
const SHARED_STATE_CACHE_TTL_MS = 2_000;

/**
 * Compute the cooldown duration for a degraded model based on failure type and history.
 * 429 (quota) gets an escalating window; transient errors use shorter fixed values.
 * (#313)
 */
export function getCooldownForReason(reason: string, failureCount: number): number {
  if (reason.includes('429')) {
    // Quota exhausted — escalating backoff: 5m, 10m, 15m (cap)
    const baseMs = 5 * 60_000;
    const cap = 15 * 60_000;
    return Math.min(baseMs * failureCount, cap);
  }
  if (reason.includes('503') || reason.includes('504')) {
    return 2 * 60_000; // 2 minutes for service-unavailable
  }
  if (reason === 'timeout') {
    return 90_000; // 90 seconds for timeouts
  }
  return DEFAULT_COOLDOWN_MS;
}

/** In-memory degraded model registry. */
const degradedModels = new Map<string, DegradedModel>();

let blobServiceClient: BlobServiceClient | undefined;
let containerInitPromise: Promise<void> | undefined;
let sharedLoadTimestampMs = 0;

/** Mark a model as degraded so subsequent requests skip it. */
export function markModelDegraded(deploymentName: string, reason: string, explicitCooldownMs?: number): void {
  const existing = degradedModels.get(deploymentName);
  const failureCount = (existing?.failureCount ?? 0) + 1;
  degradedModels.set(deploymentName, {
    deploymentName,
    degradedAt: Date.now(),
    reason,
    failureCount,
    cooldownMs: explicitCooldownMs ?? getCooldownForReason(reason, failureCount),
  });
  void persistSharedDegradedModels();
}

/** Check whether a model is currently degraded (within cooldown).
 * When `cooldownMs` is provided it overrides the per-entry stored cooldown
 * (used in tests to simulate time passing). Otherwise the per-entry cooldown
 * determined at mark time is used, falling back to the 60s default. (#313)
 */
export function isModelDegraded(deploymentName: string, cooldownMs?: number): boolean {
  const entry = degradedModels.get(deploymentName);
  if (!entry) return false;

  const effectiveCooldown = cooldownMs ?? entry.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const elapsed = Date.now() - entry.degradedAt;
  if (elapsed >= effectiveCooldown) {
    // Cooldown expired — model can be retried
    degradedModels.delete(deploymentName);
    return false;
  }
  return true;
}

/** Clear a specific model's degraded status (e.g. after a successful call). */
export function clearModelDegraded(deploymentName: string): void {
  degradedModels.delete(deploymentName);
  void persistSharedDegradedModels();
}

/** Get all currently degraded models (for telemetry / Dev Console). */
export function getDegradedModels(): DegradedModel[] {
  return Array.from(degradedModels.values());
}

/** Reset all degraded state (primarily for tests). */
export function resetAllDegraded(): void {
  degradedModels.clear();
  sharedLoadTimestampMs = 0;
}

export async function persistSharedDegradedModels(): Promise<void> {
  const containerReady = await ensureContainer();
  if (!containerReady) {
    return;
  }

  const payload = JSON.stringify(getDegradedModels());

  try {
    const blobClient = getBlobServiceClient()!
      .getContainerClient(SHARED_STATE_CONTAINER)
      .getBlockBlobClient(`model-circuit-breaker/${getScopeKey()}/degraded-models.json`);

    await blobClient.upload(payload, Buffer.byteLength(payload), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
    sharedLoadTimestampMs = Date.now();
  } catch (error) {
    console.warn('[modelCircuitBreaker] Failed to persist shared degraded model state:', error);
  }
}

export async function syncSharedDegradedModels(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - sharedLoadTimestampMs < SHARED_STATE_CACHE_TTL_MS) {
    return;
  }

  const containerReady = await ensureContainer();
  if (!containerReady) {
    return;
  }

  try {
    const blobClient = getBlobServiceClient()!
      .getContainerClient(SHARED_STATE_CONTAINER)
      .getBlockBlobClient(`model-circuit-breaker/${getScopeKey()}/degraded-models.json`);

    const response = await blobClient.download();
    const content = await streamToString(response.readableStreamBody);
    const parsed = JSON.parse(content) as DegradedModel[];

    for (const entry of parsed) {
      const existing = degradedModels.get(entry.deploymentName);
      if (!existing || existing.degradedAt < entry.degradedAt) {
        degradedModels.set(entry.deploymentName, entry);
      }
    }

    sharedLoadTimestampMs = now;
  } catch (error) {
    if (error instanceof RestError && error.statusCode === 404) {
      sharedLoadTimestampMs = now;
      return;
    }
    console.warn('[modelCircuitBreaker] Failed to sync shared degraded model state:', error);
  }
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
        console.warn('[modelCircuitBreaker] Failed to initialize shared state container:', error);
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

async function streamToString(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (!stream) {
    return '';
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString('utf-8');
}
