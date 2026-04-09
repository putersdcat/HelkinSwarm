// Session Tracer — collects telemetry events per correlation ID and builds
// a causal trace tree for the Dev Console Session Tracer panel.
// Spec ref: ADDENDA-03 (Tab Infrastructure), Issue #140
//
// Primary storage is an in-memory ring buffer for speed. A best-effort blob
// persistence fallback keeps recent traces retrievable on dirty-dev stamps that
// intentionally lack full paid observability.

import { BlobServiceClient, RestError } from '@azure/storage-blob';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TracePhaseType =
  | 'bot-receive'     // Message received from Teams (#269)
  | 'prompt-build'    // Prompt assembly (#269)
  | 'llm-call'        // LLM request/response (#269 — replaces 'llm')
  | 'tool-dispatch'   // Low-risk tool dispatch (#269 — replaces 'tool')
  | 'subagent'        // Sub-agent tool execution (#269)
  | 'executor'        // High-risk executor activity (#269)
  | 'confirmation'    // Human confirmation gate (#269)
  | 'reply-send'      // Reply sent to Teams (#269 — replaces 'reply')
  | 'verification'    // Safety verification pipeline
  | 'memory'          // Memory read/write
  | 'orchestrator'    // Orchestrator lifecycle
  // Legacy aliases — kept for backward compat
  | 'llm'
  | 'tool'
  | 'reply';
export type TracePhaseStatus = 'running' | 'completed' | 'error';

export interface TracePhase {
  id: string;
  name: string;
  type: TracePhaseType;
  startedAt: number;   // ms offset from turn start
  durationMs: number;
  status: TracePhaseStatus;
  children: TracePhase[];
  detail?: string;
  error?: string;
}

export interface TraceTree {
  correlationId: string;
  userId?: string;
  turnStartedAt: string; // ISO timestamp
  totalMs: number;
  phases: TracePhase[];
}

export interface TraceLookupResult {
  traceTree: TraceTree | null;
  lookupMode: 'exact' | 'short-prefix' | 'persisted-exact' | 'persisted-short-prefix' | 'miss';
}

// ---------------------------------------------------------------------------
// In-memory trace store (ring buffer — bounded at MAX_TRACES)
// ---------------------------------------------------------------------------

const MAX_TRACES = 200;
const traceMap = new Map<string, TraceTree>();
const traceOrder: string[] = [];
const TRACE_STORAGE_CONTAINER = 'helkinswarm-devloop';
const TRACE_STORAGE_CACHE_TTL_MS = 5_000;

let blobServiceClient: BlobServiceClient | undefined;
let containerInitPromise: Promise<void> | undefined;

const persistedExactTraceCache = new Map<string, { value?: TraceTree; loadedAtMs: number }>();
const persistedShortTraceCache = new Map<string, { value?: TraceTree; loadedAtMs: number }>();
const pendingPersistOperations = new Map<string, Promise<void>>();

function evictOldest(): void {
  while (traceOrder.length > MAX_TRACES) {
    const oldest = traceOrder.shift();
    if (oldest) traceMap.delete(oldest);
  }
}

function getOrCreateTrace(correlationId: string, userId?: string): TraceTree {
  let tree = traceMap.get(correlationId);
  if (!tree) {
    tree = {
      correlationId,
      userId,
      turnStartedAt: new Date().toISOString(),
      totalMs: 0,
      phases: [],
    };
    traceMap.set(correlationId, tree);
    traceOrder.push(correlationId);
    evictOldest();
  }
  return tree;
}

function normalizeShortCorrelation(shortCorrelation: string): string {
  return shortCorrelation
    .trim()
    .replace(/^\[?corr:/i, '')
    .replace(/\]?$/u, '')
    .toLowerCase();
}

function getTraceBlobServiceClient(): BlobServiceClient | undefined {
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

async function ensureTraceContainer(): Promise<boolean> {
  const serviceClient = getTraceBlobServiceClient();
  if (!serviceClient) {
    return false;
  }

  if (!containerInitPromise) {
    containerInitPromise = serviceClient
      .getContainerClient(TRACE_STORAGE_CONTAINER)
      .createIfNotExists()
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn('[sessionTracer] Failed to initialize persisted trace container:', error);
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

function buildExactTraceBlobName(correlationId: string): string {
  return `session-traces/${getScopeKey()}/${correlationId}.json`;
}

function buildShortTraceBlobName(shortCorrelation: string): string {
  return `session-traces-short/${getScopeKey()}/${normalizeShortCorrelation(shortCorrelation)}.json`;
}

async function persistTraceSnapshot(tree: TraceTree): Promise<void> {
  const containerReady = await ensureTraceContainer();
  if (!containerReady) {
    return;
  }

  const serialized = JSON.stringify(tree);
  const shortCorrelation = tree.correlationId.slice(0, 8).toLowerCase();

  try {
    const containerClient = getTraceBlobServiceClient()!.getContainerClient(TRACE_STORAGE_CONTAINER);
    await Promise.all([
      containerClient.getBlockBlobClient(buildExactTraceBlobName(tree.correlationId)).upload(
        serialized,
        Buffer.byteLength(serialized),
        { blobHTTPHeaders: { blobContentType: 'application/json' } },
      ),
      containerClient.getBlockBlobClient(buildShortTraceBlobName(shortCorrelation)).upload(
        serialized,
        Buffer.byteLength(serialized),
        { blobHTTPHeaders: { blobContentType: 'application/json' } },
      ),
    ]);

    const loadedAtMs = Date.now();
    persistedExactTraceCache.set(tree.correlationId, { value: tree, loadedAtMs });
    persistedShortTraceCache.set(shortCorrelation, { value: tree, loadedAtMs });
  } catch (error: unknown) {
    console.warn('[sessionTracer] Failed to persist trace snapshot:', error);
  }
}

function scheduleTracePersistence(tree: TraceTree): void {
  const correlationId = tree.correlationId;
  const previous = pendingPersistOperations.get(correlationId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => persistTraceSnapshot(tree));

  pendingPersistOperations.set(correlationId, next);
  void next.finally(() => {
    if (pendingPersistOperations.get(correlationId) === next) {
      pendingPersistOperations.delete(correlationId);
    }
  });
}

async function loadPersistedTraceFromBlob(blobName: string): Promise<TraceTree | undefined> {
  const containerReady = await ensureTraceContainer();
  if (!containerReady) {
    return undefined;
  }

  try {
    const blobClient = getTraceBlobServiceClient()!
      .getContainerClient(TRACE_STORAGE_CONTAINER)
      .getBlockBlobClient(blobName);
    const response = await blobClient.download();
    const content = await streamToString(response.readableStreamBody);
    return JSON.parse(content) as TraceTree;
  } catch (error: unknown) {
    if (error instanceof RestError && error.statusCode === 404) {
      return undefined;
    }

    console.warn('[sessionTracer] Failed to load persisted trace snapshot:', error);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Recording API — called from telemetry instrumentation points
// ---------------------------------------------------------------------------

export interface RecordPhaseInput {
  correlationId: string;
  userId?: string;
  phaseId: string;
  name: string;
  type: TracePhaseType;
  durationMs: number;
  status: TracePhaseStatus;
  parentPhaseId?: string;
  detail?: string;
  error?: string;
}

/**
 * Record a phase in the trace tree for a given correlation ID.
 * Phases are added to the root or as children of an existing parent.
 */
export function recordTracePhase(input: RecordPhaseInput): void {
  const tree = getOrCreateTrace(input.correlationId, input.userId);

  const phase: TracePhase = {
    id: input.phaseId,
    name: input.name,
    type: input.type,
    startedAt: Date.now() - new Date(tree.turnStartedAt).getTime(),
    durationMs: input.durationMs,
    status: input.status,
    children: [],
    detail: input.detail,
    error: input.error,
  };

  if (input.parentPhaseId) {
    const parent = findPhase(tree.phases, input.parentPhaseId);
    if (parent) {
      parent.children.push(phase);
    } else {
      // Parent not found — add at root as fallback
      tree.phases.push(phase);
    }
  } else {
    tree.phases.push(phase);
  }

  // Recompute total duration
  tree.totalMs = computeTotalMs(tree.phases);
  scheduleTracePersistence(tree);
}

/**
 * Mark a running phase as completed.
 */
export function completeTracePhase(
  correlationId: string,
  phaseId: string,
  durationMs: number,
  status: TracePhaseStatus = 'completed',
  error?: string,
): void {
  const tree = traceMap.get(correlationId);
  if (!tree) return;

  const phase = findPhase(tree.phases, phaseId);
  if (phase) {
    phase.durationMs = durationMs;
    phase.status = status;
    if (error) phase.error = error;
  }

  tree.totalMs = computeTotalMs(tree.phases);
  scheduleTracePersistence(tree);
}

// ---------------------------------------------------------------------------
// Query API — used by the Dev Console endpoint
// ---------------------------------------------------------------------------

/**
 * Get the trace tree for a correlation ID.
 */
export function getTraceTree(correlationId: string): TraceTree | undefined {
  return traceMap.get(correlationId);
}

/**
 * Find the most recent trace tree whose full correlationId starts with a short footer token.
 * Footer telemetry only exposes the first 8 chars (corr:xxxxxxxx), while the runtime keeps
 * the full UUID correlationId in-memory.
 */
export function findTraceTreeByShortCorrelation(shortCorrelation: string): TraceTree | undefined {
  const normalized = normalizeShortCorrelation(shortCorrelation);

  if (normalized.length === 0) {
    return undefined;
  }

  for (let i = traceOrder.length - 1; i >= 0; i--) {
    const tree = traceMap.get(traceOrder[i]);
    if (tree && tree.correlationId.toLowerCase().startsWith(normalized)) {
      return tree;
    }
  }

  return undefined;
}

export async function loadPersistedTraceTree(correlationId: string): Promise<TraceTree | undefined> {
  const cached = persistedExactTraceCache.get(correlationId);
  const now = Date.now();
  if (cached && now - cached.loadedAtMs < TRACE_STORAGE_CACHE_TTL_MS) {
    return cached.value;
  }

  const loaded = await loadPersistedTraceFromBlob(buildExactTraceBlobName(correlationId));
  persistedExactTraceCache.set(correlationId, { value: loaded, loadedAtMs: now });
  return loaded;
}

export async function loadPersistedTraceTreeByShortCorrelation(shortCorrelation: string): Promise<TraceTree | undefined> {
  const normalized = normalizeShortCorrelation(shortCorrelation);
  if (normalized.length === 0) {
    return undefined;
  }

  const cached = persistedShortTraceCache.get(normalized);
  const now = Date.now();
  if (cached && now - cached.loadedAtMs < TRACE_STORAGE_CACHE_TTL_MS) {
    return cached.value;
  }

  const loaded = await loadPersistedTraceFromBlob(buildShortTraceBlobName(normalized));
  persistedShortTraceCache.set(normalized, { value: loaded, loadedAtMs: now });
  return loaded;
}

export async function loadTraceTreeWithFallback(correlationOrShortTag: string): Promise<TraceLookupResult> {
  const exactTraceTree = getTraceTree(correlationOrShortTag);
  if (exactTraceTree) {
    return { traceTree: exactTraceTree, lookupMode: 'exact' };
  }

  const shortTraceTree = findTraceTreeByShortCorrelation(correlationOrShortTag);
  if (shortTraceTree) {
    return { traceTree: shortTraceTree, lookupMode: 'short-prefix' };
  }

  const persistedExactTraceTree = await loadPersistedTraceTree(correlationOrShortTag);
  if (persistedExactTraceTree) {
    return { traceTree: persistedExactTraceTree, lookupMode: 'persisted-exact' };
  }

  const persistedShortTraceTree = await loadPersistedTraceTreeByShortCorrelation(correlationOrShortTag);
  if (persistedShortTraceTree) {
    return { traceTree: persistedShortTraceTree, lookupMode: 'persisted-short-prefix' };
  }

  return { traceTree: null, lookupMode: 'miss' };
}

export interface TraceListFilter {
  limit?: number;
  sinceIso?: string; // ISO timestamp — only traces after this time
  untilIso?: string; // ISO timestamp — only traces before this time
}

/**
 * List recent trace trees (most recent first) with optional time range filtering (#269).
 */
export function listRecentTraces(limitOrFilter: number | TraceListFilter = 20): Array<{ correlationId: string; turnStartedAt: string; totalMs: number; phaseCount: number }> {
  const opts: TraceListFilter = typeof limitOrFilter === 'number'
    ? { limit: limitOrFilter }
    : limitOrFilter;
  const limit = opts.limit ?? 20;
  const sinceMs = opts.sinceIso ? new Date(opts.sinceIso).getTime() : 0;
  const untilMs = opts.untilIso ? new Date(opts.untilIso).getTime() : Infinity;

  const results: Array<{ correlationId: string; turnStartedAt: string; totalMs: number; phaseCount: number }> = [];
  for (let i = traceOrder.length - 1; i >= 0 && results.length < limit; i--) {
    const tree = traceMap.get(traceOrder[i]);
    if (tree) {
      const treeMs = new Date(tree.turnStartedAt).getTime();
      if (treeMs < sinceMs || treeMs > untilMs) continue;
      results.push({
        correlationId: tree.correlationId,
        turnStartedAt: tree.turnStartedAt,
        totalMs: tree.totalMs,
        phaseCount: countPhases(tree.phases),
      });
    }
  }
  return results;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findPhase(phases: TracePhase[], id: string): TracePhase | undefined {
  for (const p of phases) {
    if (p.id === id) return p;
    const child = findPhase(p.children, id);
    if (child) return child;
  }
  return undefined;
}

function computeTotalMs(phases: TracePhase[]): number {
  let max = 0;
  for (const p of phases) {
    const end = p.startedAt + p.durationMs;
    if (end > max) max = end;
  }
  return max;
}

function countPhases(phases: TracePhase[]): number {
  let count = phases.length;
  for (const p of phases) {
    count += countPhases(p.children);
  }
  return count;
}
