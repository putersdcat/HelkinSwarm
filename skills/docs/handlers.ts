// docs skill handlers — AI-native document storage backed by Azure Blob + Cosmos DB.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md §6
// Issue: #244
//
// Auth: UAMI credential (ManagedIdentityCredential when AZURE_CLIENT_ID is set,
//       DefaultAzureCredential in local dev).
// Blob: DOCS_STORAGE_ACCOUNT_NAME env var → helkinswarmst{alias} storage account
//       Container: 'docs' (auto-created on first use)
//       Blob path:  {userId}/{docId}.md
// Cosmos: COSMOS_ENDPOINT env var → 'helkinswarm' DB → 'docs' container (partition: /userId)

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import { CosmosClient, type SqlParameter } from '@azure/cosmos';
import { BlobServiceClient } from '@azure/storage-blob';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const COSMOS_DATABASE = 'helkinswarm';
const COSMOS_CONTAINER = 'docs';
const BLOB_CONTAINER = 'docs';

// ---------------------------------------------------------------------------
// Credential singleton — mirrors vault/handlers.ts pattern
// ---------------------------------------------------------------------------

let _cred: TokenCredential | undefined;

function getCredential(): TokenCredential {
  if (!_cred) {
    const clientId = process.env['AZURE_CLIENT_ID'];
    _cred = clientId
      ? new ManagedIdentityCredential({ clientId })
      : new DefaultAzureCredential();
  }
  return _cred;
}

// ---------------------------------------------------------------------------
// Cosmos singleton — per-skill, no cross-boundary src/ import
// ---------------------------------------------------------------------------

let _cosmos: CosmosClient | undefined;

function getDocsContainer() {
  if (!_cosmos) {
    const endpoint = process.env['COSMOS_ENDPOINT'];
    if (!endpoint) {
      throw new Error(
        'Document storage not configured — COSMOS_ENDPOINT is not set.',
      );
    }
    _cosmos = new CosmosClient({
      endpoint,
      aadCredentials: getCredential(),
      connectionPolicy: { requestTimeout: 10_000 },
    });
  }
  return _cosmos.database(COSMOS_DATABASE).container(COSMOS_CONTAINER);
}

// ---------------------------------------------------------------------------
// Blob singleton — auto-creates the 'docs' container on first use
// ---------------------------------------------------------------------------

let _blobService: BlobServiceClient | undefined;
let _blobContainerReady = false;

async function getBlobContainerClient() {
  if (!_blobService) {
    const accountName = process.env['DOCS_STORAGE_ACCOUNT_NAME'];
    if (!accountName) {
      throw new Error(
        'Document storage not configured — DOCS_STORAGE_ACCOUNT_NAME is not set.',
      );
    }
    _blobService = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      getCredential(),
    );
  }
  const client = _blobService.getContainerClient(BLOB_CONTAINER);
  if (!_blobContainerReady) {
    await client.createIfNotExists();
    _blobContainerReady = true;
  }
  return client;
}

// ---------------------------------------------------------------------------
// Types and Zod schemas
// ---------------------------------------------------------------------------

/** Plain TypeScript interface — used as generic constraint for Cosmos SDK calls */
interface DocMeta {
  id: string;
  userId: string;
  title: string;
  tags: string[];
  summary: string;
  blobPath: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

const DocMetaSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  title: z.string().min(1).max(255),
  tags: z.array(z.string()),
  summary: z.string(),
  blobPath: z.string(),
  sizeBytes: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const DocsSaveArgsSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  tags: z.union([z.array(z.string()), z.undefined()]).optional(),
  userId: z.string().min(1),          // injected by toolDispatchActivity
  correlationId: z.string().optional(), // injected by toolDispatchActivity
});

const DocsGetArgsSchema = z.object({
  docId: z.string().uuid(),
  userId: z.string().min(1),
});

const DocsListArgsSchema = z.object({
  tag: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().min(1),
});

const DocsSearchArgsSchema = z.object({
  query: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  userId: z.string().min(1),
});

const DocsDeleteArgsSchema = z.object({
  docId: z.string().uuid(),
  userId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Tool: docs_save
// ---------------------------------------------------------------------------

export const docs_save: ToolHandler = async (args) => {
  const { title, content, tags, userId } = DocsSaveArgsSchema.parse(args);

  const docId = randomUUID();
  const now = new Date().toISOString();
  const blobPath = `${userId}/${docId}.md`;
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  const summary = content.slice(0, 500).replace(/[\n\r]+/g, ' ').trim();

  // 1. Upload blob
  const containerClient = await getBlobContainerClient();
  const blobClient = containerClient.getBlockBlobClient(blobPath);
  await blobClient.upload(content, sizeBytes, {
    blobHTTPHeaders: { blobContentType: 'text/markdown; charset=utf-8' },
  });

  // 2. Upsert Cosmos metadata
  const meta: DocMeta = {
    id: docId,
    userId,
    title,
    tags: tags ?? [],
    summary,
    blobPath,
    sizeBytes,
    createdAt: now,
    updatedAt: now,
  };
  await getDocsContainer().items.create<DocMeta>(meta);

  const tagLine = (tags && tags.length > 0) ? ` [${tags.join(', ')}]` : '';
  return `Document saved: "${title}"${tagLine}\nID: ${docId}\nSize: ${sizeBytes} bytes`;
};

// ---------------------------------------------------------------------------
// Tool: docs_get
// ---------------------------------------------------------------------------

export const docs_get: ToolHandler = async (args) => {
  const { docId, userId } = DocsGetArgsSchema.parse(args);

  // Read Cosmos metadata
  const { resource: rawMeta } = await getDocsContainer().item(docId, userId).read<DocMeta>();
  if (!rawMeta) {
    return `Document not found: ${docId}`;
  }
  const meta = DocMetaSchema.parse(rawMeta);

  // Read blob content
  const containerClient = await getBlobContainerClient();
  const blobClient = containerClient.getBlockBlobClient(meta.blobPath);
  const downloadResponse = await blobClient.download(0);
  if (!downloadResponse.readableStreamBody) {
    return `Document blob missing for ID: ${docId}`;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of downloadResponse.readableStreamBody as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  const content = Buffer.concat(chunks).toString('utf8');

  const tagLine = meta.tags.length > 0 ? `\nTags: ${meta.tags.join(', ')}` : '';
  return `# ${meta.title}${tagLine}\nID: ${meta.id} | Saved: ${meta.createdAt}\n\n${content}`;
};

// ---------------------------------------------------------------------------
// Tool: docs_list
// ---------------------------------------------------------------------------

export const docs_list: ToolHandler = async (args) => {
  const { tag, limit, userId } = DocsListArgsSchema.parse(args);

  const container = getDocsContainer();
  let query: string;
  const parameters: SqlParameter[] = [
    { name: '@userId', value: userId },
    { name: '@limit', value: limit },
  ];

  if (tag) {
    query = `SELECT c.id, c.title, c.tags, c.sizeBytes, c.createdAt, c.updatedAt
             FROM c
             WHERE c.userId = @userId AND ARRAY_CONTAINS(c.tags, @tag)
             ORDER BY c.updatedAt DESC
             OFFSET 0 LIMIT @limit`;
    parameters.push({ name: '@tag', value: tag });
  } else {
    query = `SELECT c.id, c.title, c.tags, c.sizeBytes, c.createdAt, c.updatedAt
             FROM c
             WHERE c.userId = @userId
             ORDER BY c.updatedAt DESC
             OFFSET 0 LIMIT @limit`;
  }

  const { resources } = await container.items.query<DocMeta>({  // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    query,
    parameters,
  }).fetchAll();

  if (resources.length === 0) {
    return tag
      ? `No documents found with tag "${tag}".`
      : 'No documents stored yet.';
  }

  const lines = resources.map((d) => {
    const parsed = DocMetaSchema.partial().parse(d);
    const tagStr = (parsed.tags?.length ?? 0) > 0 ? ` [${(parsed.tags ?? []).join(', ')}]` : '';
    const kb = ((parsed.sizeBytes ?? 0) / 1024).toFixed(1);
    return `• ${parsed.title ?? '(untitled)'} ${tagStr}(${kb} KB) — id: ${parsed.id ?? '?'}`;
  });

  return `Documents (${resources.length}):\n${lines.join('\n')}`;
};

// ---------------------------------------------------------------------------
// Tool: docs_search
// ---------------------------------------------------------------------------

export const docs_search: ToolHandler = async (args) => {
  const { query, limit, userId } = DocsSearchArgsSchema.parse(args);

  const container = getDocsContainer();
  const { resources } = await container.items.query<DocMeta>({
    query: `SELECT c.id, c.title, c.tags, c.summary, c.createdAt
            FROM c
            WHERE c.userId = @userId
              AND (CONTAINS(LOWER(c.title), LOWER(@q)) OR CONTAINS(LOWER(c.summary), LOWER(@q)))
            ORDER BY c.updatedAt DESC
            OFFSET 0 LIMIT @limit`,
    parameters: [
      { name: '@userId', value: userId } as SqlParameter,
      { name: '@q', value: query } as SqlParameter,
      { name: '@limit', value: limit } as SqlParameter,
    ],
  }).fetchAll();

  if (resources.length === 0) {
    return `No documents found matching "${query}".`;
  }

  const lines = resources.map((rawD) => {
    const d = DocMetaSchema.partial().parse(rawD);
    const tagStr = (d.tags?.length ?? 0) > 0 ? ` [${(d.tags ?? []).join(', ')}]` : '';
    const snippet = (d.summary ?? '').slice(0, 120).replace(/\s+/g, ' ');
    return `• ${d.title ?? '(untitled)'}${tagStr} — id: ${d.id ?? '?'}\n  ${snippet}…`;
  });

  return `Search results for "${query}" (${resources.length}):\n${lines.join('\n')}`;
};

// ---------------------------------------------------------------------------
// Tool: docs_delete
// ---------------------------------------------------------------------------

export const docs_delete: ToolHandler = async (args) => {
  const { docId, userId } = DocsDeleteArgsSchema.parse(args);

  // Read metadata first to get blobPath
  const { resource: rawMeta } = await getDocsContainer().item(docId, userId).read<DocMeta>();
  if (!rawMeta) {
    return `Document not found: ${docId}`;
  }
  const meta = DocMetaSchema.parse(rawMeta);

  // Delete blob
  const containerClient = await getBlobContainerClient();
  const blobClient = containerClient.getBlockBlobClient(meta.blobPath);
  await blobClient.deleteIfExists({ deleteSnapshots: 'include' });

  // Delete Cosmos metadata
  await getDocsContainer().item(docId, userId).delete();

  return `Document "${meta.title}" (id: ${docId}) has been permanently deleted.`;
};
