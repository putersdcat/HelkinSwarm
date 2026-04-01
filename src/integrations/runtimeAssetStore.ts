import { randomUUID, createHash } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import { z } from 'zod';
import { getCredential } from '../auth/identity.js';

export const RUNTIME_ASSET_CONTAINER_NAME = 'helkinswarm-runtime-assets';
export const DEFAULT_RUNTIME_ASSET_TTL_SECONDS = 6 * 60 * 60;
export const MAX_RUNTIME_ASSET_TTL_SECONDS = 24 * 60 * 60;

let blobServiceClient: BlobServiceClient | undefined;
let containerInitPromise: Promise<void> | undefined;

export const RuntimeAssetKindSchema = z.enum(['image', 'document', 'file', 'audio', 'video', 'unknown']);
export type RuntimeAssetKind = z.infer<typeof RuntimeAssetKindSchema>;

export const RuntimeAssetSourceSchema = z.object({
  channel: z.enum(['teams', 'outlook', 'tool', 'generated', 'system', 'unknown']),
  attachmentKind: z.enum(['inline-image', 'file-download', 'generic-attachment']).optional(),
  conversationId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  toolName: z.string().min(1).optional(),
  externalId: z.string().min(1).optional(),
  detail: z.string().min(1).optional(),
});
export type RuntimeAssetSource = z.infer<typeof RuntimeAssetSourceSchema>;

export const RuntimeAssetStorageLocationSchema = z.object({
  container: z.string().min(1),
  payloadBlobPath: z.string().min(1),
  metadataBlobPath: z.string().min(1),
});
export type RuntimeAssetStorageLocation = z.infer<typeof RuntimeAssetStorageLocationSchema>;

export const RuntimeAssetReferenceSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  userId: z.string().min(1),
  correlationId: z.string().min(1),
  kind: RuntimeAssetKindSchema,
  contentType: z.string().min(1),
  fileName: z.string().min(1).optional(),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  source: RuntimeAssetSourceSchema,
  summary: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  ttlSeconds: z.number().int().positive(),
  storage: RuntimeAssetStorageLocationSchema,
});
export type RuntimeAssetReference = z.infer<typeof RuntimeAssetReferenceSchema>;

export const PersistRuntimeAssetInputSchema = z.object({
  userId: z.string().min(1),
  correlationId: z.string().min(1),
  contentType: z.string().min(1),
  fileName: z.string().min(1).optional(),
  bytes: z.instanceof(Uint8Array),
  source: RuntimeAssetSourceSchema,
  kind: RuntimeAssetKindSchema.optional(),
  summary: z.string().min(1).optional(),
  ttlSeconds: z.number().int().positive().max(MAX_RUNTIME_ASSET_TTL_SECONDS).default(DEFAULT_RUNTIME_ASSET_TTL_SECONDS),
});
export type PersistRuntimeAssetInput = z.input<typeof PersistRuntimeAssetInputSchema>;

export const RuntimeAssetLookupSchema = z.object({
  userId: z.string().min(1),
  assetId: z.string().uuid(),
});
export type RuntimeAssetLookup = z.infer<typeof RuntimeAssetLookupSchema>;

export interface RuntimeAssetContentResult {
  reference: RuntimeAssetReference;
  content: Buffer;
}

function inferRuntimeAssetKind(contentType: string): RuntimeAssetKind {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.startsWith('video/')) return 'video';
  if (
    normalized === 'application/pdf'
    || normalized.startsWith('text/')
    || normalized.includes('word')
    || normalized.includes('presentation')
    || normalized.includes('spreadsheet')
  ) {
    return 'document';
  }
  if (normalized.length > 0) {
    return 'file';
  }
  return 'unknown';
}

function sanitizePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

function buildAssetPaths(userId: string, assetId: string): RuntimeAssetStorageLocation {
  const basePath = `runtime-assets/${sanitizePathSegment(userId)}/${assetId}`;
  return {
    container: RUNTIME_ASSET_CONTAINER_NAME,
    payloadBlobPath: `${basePath}/payload.bin`,
    metadataBlobPath: `${basePath}/metadata.json`,
  };
}

function computeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (
      ('statusCode' in error && error.statusCode === 404)
      || ('code' in error && error.code === 'BlobNotFound')
    );
}

function toLookup(input: RuntimeAssetReference | RuntimeAssetLookup): RuntimeAssetLookup {
  if ('assetId' in input) {
    return RuntimeAssetLookupSchema.parse(input);
  }

  return RuntimeAssetLookupSchema.parse({
    userId: input.userId,
    assetId: input.id,
  });
}

function getBlobServiceClient(): BlobServiceClient | undefined {
  if (blobServiceClient) {
    return blobServiceClient;
  }

  const connectionString = process.env['AzureWebJobsStorage'] ?? process.env['AZUREWEBJOBSSTORAGE'];
  if (connectionString) {
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    return blobServiceClient;
  }

  const accountName = process.env['AzureWebJobsStorage__accountName'];
  if (!accountName) {
    return undefined;
  }

  blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    getCredential(),
  );
  return blobServiceClient;
}

async function ensureContainer(): Promise<boolean> {
  const serviceClient = getBlobServiceClient();
  if (!serviceClient) {
    return false;
  }

  if (!containerInitPromise) {
    containerInitPromise = serviceClient
      .getContainerClient(RUNTIME_ASSET_CONTAINER_NAME)
      .createIfNotExists()
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn('[runtimeAssetStore] Failed to initialize asset container:', error);
        containerInitPromise = undefined;
      });
  }

  await containerInitPromise;
  return true;
}

async function streamToBuffer(stream: NodeJS.ReadableStream | undefined): Promise<Buffer> {
  if (!stream) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function isRuntimeAssetExpired(reference: RuntimeAssetReference, now = new Date()): boolean {
  return now.getTime() >= new Date(reference.expiresAt).getTime();
}

export function buildRuntimeAssetPromptSummary(reference: RuntimeAssetReference): string {
  const namePart = reference.fileName ? `file \`${reference.fileName}\`` : `asset \`${reference.id}\``;
  return [
    `Runtime asset reference available: ${namePart}.`,
    `Asset ID: \`${reference.id}\`.`,
    `Content type: ${reference.contentType}.`,
    `Size: ${reference.byteLength} bytes.`,
    `Expires at: ${reference.expiresAt}.`,
    'Pass this reference to downstream tools instead of inlining raw bytes unless the user explicitly requests extraction or rendering.',
  ].join(' ');
}

export async function persistRuntimeAsset(input: PersistRuntimeAssetInput): Promise<RuntimeAssetReference | null> {
  const parsed = PersistRuntimeAssetInputSchema.parse(input);
  const containerReady = await ensureContainer();
  if (!containerReady) {
    return null;
  }

  const id = randomUUID();
  const createdAt = new Date();
  const storage = buildAssetPaths(parsed.userId, id);
  const bytes = Buffer.from(parsed.bytes);
  const reference: RuntimeAssetReference = RuntimeAssetReferenceSchema.parse({
    version: 1,
    id,
    userId: parsed.userId,
    correlationId: parsed.correlationId,
    kind: parsed.kind ?? inferRuntimeAssetKind(parsed.contentType),
    contentType: parsed.contentType,
    ...(parsed.fileName ? { fileName: parsed.fileName } : {}),
    byteLength: bytes.byteLength,
    sha256: computeSha256(bytes),
    source: parsed.source,
    ...(parsed.summary ? { summary: parsed.summary } : {}),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + parsed.ttlSeconds * 1000).toISOString(),
    ttlSeconds: parsed.ttlSeconds,
    storage,
  });

  try {
    const containerClient = getBlobServiceClient()!.getContainerClient(RUNTIME_ASSET_CONTAINER_NAME);
    await containerClient.getBlockBlobClient(storage.payloadBlobPath).upload(bytes, bytes.byteLength, {
      blobHTTPHeaders: { blobContentType: parsed.contentType },
    });

    const metadata = JSON.stringify(reference, null, 2);
    await containerClient.getBlockBlobClient(storage.metadataBlobPath).upload(
      metadata,
      Buffer.byteLength(metadata),
      { blobHTTPHeaders: { blobContentType: 'application/json' } },
    );

    return reference;
  } catch (error: unknown) {
    console.warn('[runtimeAssetStore] Failed to persist runtime asset:', error);
    await deleteRuntimeAsset(reference);
    return null;
  }
}

export async function loadRuntimeAssetReference(
  input: RuntimeAssetReference | RuntimeAssetLookup,
): Promise<RuntimeAssetReference | null> {
  const lookup = toLookup(input);
  const containerReady = await ensureContainer();
  if (!containerReady) {
    return null;
  }

  const storage = buildAssetPaths(lookup.userId, lookup.assetId);
  try {
    const containerClient = getBlobServiceClient()!.getContainerClient(RUNTIME_ASSET_CONTAINER_NAME);
    const response = await containerClient.getBlockBlobClient(storage.metadataBlobPath).download();
    const content = await streamToBuffer(response.readableStreamBody);
    const parsed = RuntimeAssetReferenceSchema.parse(JSON.parse(content.toString('utf8')) as unknown);
    if (isRuntimeAssetExpired(parsed)) {
      await deleteRuntimeAsset(parsed);
      return null;
    }
    return parsed;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return null;
    }
    console.warn('[runtimeAssetStore] Failed to load asset reference:', error);
    return null;
  }
}

export async function readRuntimeAssetContent(
  input: RuntimeAssetReference | RuntimeAssetLookup,
): Promise<RuntimeAssetContentResult | null> {
  const reference = await loadRuntimeAssetReference(input);
  if (!reference) {
    return null;
  }

  try {
    const containerClient = getBlobServiceClient()!.getContainerClient(RUNTIME_ASSET_CONTAINER_NAME);
    const response = await containerClient.getBlockBlobClient(reference.storage.payloadBlobPath).download();
    const content = await streamToBuffer(response.readableStreamBody);
    return { reference, content };
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return null;
    }
    console.warn('[runtimeAssetStore] Failed to read asset content:', error);
    return null;
  }
}

export async function deleteRuntimeAsset(
  input: RuntimeAssetReference | RuntimeAssetLookup,
): Promise<boolean> {
  const lookup = toLookup(input);
  const containerReady = await ensureContainer();
  if (!containerReady) {
    return false;
  }

  const storage = buildAssetPaths(lookup.userId, lookup.assetId);
  try {
    const containerClient = getBlobServiceClient()!.getContainerClient(RUNTIME_ASSET_CONTAINER_NAME);
    const [payloadDeleted, metadataDeleted] = await Promise.all([
      containerClient.getBlockBlobClient(storage.payloadBlobPath).deleteIfExists(),
      containerClient.getBlockBlobClient(storage.metadataBlobPath).deleteIfExists(),
    ]);
    return payloadDeleted.succeeded || metadataDeleted.succeeded;
  } catch (error: unknown) {
    console.warn('[runtimeAssetStore] Failed to delete asset:', error);
    return false;
  }
}

export function resetRuntimeAssetStore(): void {
  blobServiceClient = undefined;
  containerInitPromise = undefined;
}