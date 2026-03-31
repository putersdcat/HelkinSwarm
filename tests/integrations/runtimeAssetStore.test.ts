import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

type BlobEntry = {
  content: Buffer;
  contentType?: string;
};

async function loadModule(options?: { useIdentity?: boolean }) {
  vi.resetModules();

  const blobStore = new Map<string, BlobEntry>();
  const createIfNotExists = vi.fn(async () => undefined);
  const fromConnectionString = vi.fn((connectionString: string) => new MockBlobServiceClient(`cs:${connectionString}`));
  const getCredential = vi.fn(() => 'credential');

  class MockBlockBlobClient {
    constructor(private readonly key: string) {}

    async upload(content: Uint8Array | string, _length: number, options?: { blobHTTPHeaders?: { blobContentType?: string } }): Promise<void> {
      const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
      blobStore.set(this.key, {
        content: buffer,
        contentType: options?.blobHTTPHeaders?.blobContentType,
      });
    }

    async download(): Promise<{ readableStreamBody: NodeJS.ReadableStream }> {
      const entry = blobStore.get(this.key);
      if (!entry) {
        const error = new Error('Blob not found') as Error & { statusCode: number; code: string };
        error.statusCode = 404;
        error.code = 'BlobNotFound';
        throw error;
      }

      return { readableStreamBody: Readable.from([entry.content]) };
    }

    async deleteIfExists(): Promise<{ succeeded: boolean }> {
      const succeeded = blobStore.delete(this.key);
      return { succeeded };
    }
  }

  class MockContainerClient {
    constructor(private readonly name: string) {}

    createIfNotExists = createIfNotExists;

    getBlockBlobClient(path: string): MockBlockBlobClient {
      return new MockBlockBlobClient(`${this.name}:${path}`);
    }
  }

  class MockBlobServiceClient {
    static fromConnectionString = fromConnectionString;

    constructor(_endpoint: string, _credential?: unknown) {}

    getContainerClient(name: string): MockContainerClient {
      return new MockContainerClient(name);
    }
  }

  if (options?.useIdentity) {
    delete process.env['AzureWebJobsStorage'];
    process.env['AzureWebJobsStorage__accountName'] = 'testaccount';
  } else {
    process.env['AzureWebJobsStorage'] = 'UseDevelopmentStorage=true';
    delete process.env['AzureWebJobsStorage__accountName'];
  }
  process.env['MICROSOFT_APP_ID'] = 'test-app-id';
  process.env['MICROSOFT_APP_TENANT_ID'] = 'test-tenant-id';

  vi.doMock('@azure/storage-blob', () => ({
    BlobServiceClient: MockBlobServiceClient,
  }));

  vi.doMock('../../src/auth/identity.js', () => ({
    getCredential,
  }));

  const mod = await import('../../src/integrations/runtimeAssetStore.js');
  mod.resetRuntimeAssetStore();

  return {
    ...mod,
    blobStore,
    createIfNotExists,
    fromConnectionString,
    getCredential,
  };
}

describe('runtimeAssetStore', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@azure/storage-blob');
    vi.doUnmock('../../src/auth/identity.js');
    delete process.env['AzureWebJobsStorage'];
    delete process.env['AzureWebJobsStorage__accountName'];
    delete process.env['MICROSOFT_APP_ID'];
    delete process.env['MICROSOFT_APP_TENANT_ID'];
  });

  it('persists, reloads, reads, summarizes, and deletes runtime assets via connection-string storage', async () => {
    const {
      buildRuntimeAssetPromptSummary,
      deleteRuntimeAsset,
      loadRuntimeAssetReference,
      persistRuntimeAsset,
      readRuntimeAssetContent,
      RUNTIME_ASSET_CONTAINER_NAME,
      fromConnectionString,
      getCredential,
    } = await loadModule();

    const reference = await persistRuntimeAsset({
      userId: 'user-1',
      correlationId: 'corr-1',
      bytes: Buffer.from('hello asset store', 'utf8'),
      contentType: 'text/plain',
      fileName: 'hello.txt',
      source: {
        channel: 'tool',
        toolName: 'unit-test',
      },
      summary: 'Unit-test runtime asset.',
    });

    expect(reference).not.toBeNull();
    expect(reference?.storage.container).toBe(RUNTIME_ASSET_CONTAINER_NAME);
    expect(reference?.kind).toBe('document');
    expect(reference?.byteLength).toBe(Buffer.byteLength('hello asset store'));
    expect(fromConnectionString).toHaveBeenCalledOnce();
    expect(getCredential).not.toHaveBeenCalled();

    const loadedReference = await loadRuntimeAssetReference(reference!);
    expect(loadedReference).toEqual(reference);

    const loadedContent = await readRuntimeAssetContent(reference!);
    expect(loadedContent?.content.toString('utf8')).toBe('hello asset store');

    const promptSummary = buildRuntimeAssetPromptSummary(reference!);
    expect(promptSummary).toContain('hello.txt');
    expect(promptSummary).toContain('Pass this reference to downstream tools');

    const deleted = await deleteRuntimeAsset(reference!);
    expect(deleted).toBe(true);
    await expect(loadRuntimeAssetReference(reference!)).resolves.toBeNull();
  });

  it('supports identity-based AzureWebJobsStorage configuration and explicit expiry checks', async () => {
    const {
      isRuntimeAssetExpired,
      persistRuntimeAsset,
      fromConnectionString,
    } = await loadModule({ useIdentity: true });

    const reference = await persistRuntimeAsset({
      userId: 'user-2',
      correlationId: 'corr-2',
      bytes: Buffer.from([1, 2, 3, 4]),
      contentType: 'application/octet-stream',
      source: {
        channel: 'system',
        detail: 'identity-path test',
      },
      ttlSeconds: 60,
    });

    expect(reference).not.toBeNull();
    expect(fromConnectionString).not.toHaveBeenCalled();

    const future = new Date(new Date(reference!.expiresAt).getTime() + 1_000);
    expect(isRuntimeAssetExpired(reference!, future)).toBe(true);
  });
});