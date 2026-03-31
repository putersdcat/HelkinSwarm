import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadModule() {
  vi.resetModules();

  const persistRuntimeAsset = vi.fn(async (input: {
    userId: string;
    correlationId: string;
    contentType: string;
    fileName?: string;
    bytes: Uint8Array;
    source: {
      channel: 'teams';
      attachmentKind?: 'inline-image' | 'file-download' | 'generic-attachment';
      conversationId?: string;
      messageId?: string;
      externalId?: string;
      detail?: string;
    };
    summary?: string;
  }) => ({
    version: 1 as const,
    id: crypto.randomUUID(),
    userId: input.userId,
    correlationId: input.correlationId,
    kind: input.contentType.startsWith('image/') ? 'image' as const : 'file' as const,
    contentType: input.contentType,
    ...(input.fileName ? { fileName: input.fileName } : {}),
    byteLength: input.bytes.byteLength,
    sha256: 'a'.repeat(64),
    source: input.source,
    ...(input.summary ? { summary: input.summary } : {}),
    createdAt: '2026-03-31T00:00:00.000Z',
    expiresAt: '2026-03-31T06:00:00.000Z',
    ttlSeconds: 21600,
    storage: {
      container: 'helkinswarm-runtime-assets',
      payloadBlobPath: `payload/${input.fileName ?? 'asset'}`,
      metadataBlobPath: `metadata/${input.fileName ?? 'asset'}.json`,
    },
  }));

  vi.doMock('../../src/integrations/runtimeAssetStore.js', () => ({
    persistRuntimeAsset,
    buildRuntimeAssetPromptSummary: (reference: { fileName?: string; contentType: string; byteLength: number }) =>
      `Runtime asset reference available: file \`${reference.fileName ?? 'asset'}\`. Content type: ${reference.contentType}. Size: ${reference.byteLength} bytes.`,
  }));

  const mod = await import('../../src/bot/inboundAttachmentIngestion.js');
  return { ...mod, persistRuntimeAsset };
}

describe('inboundAttachmentIngestion', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../src/integrations/runtimeAssetStore.js');
  });

  it('ingests inline images and Teams file-download attachments as runtime assets', async () => {
    const { ingestTeamsAttachments, persistRuntimeAsset } = await loadModule();
    const getBotToken = vi.fn(async () => 'bot-token');
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://teams.test/image.png') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer bot-token' });
        return new Response(Buffer.from([137, 80, 78, 71]), { status: 200 });
      }

      if (url === 'https://download.test/file.txt') {
        return new Response(Buffer.from('hello file', 'utf8'), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    const result = await ingestTeamsAttachments({
      userId: 'user-1',
      correlationId: 'corr-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      attachments: [
        {
          contentType: 'image/png',
          contentUrl: 'https://teams.test/image.png',
          name: 'photo.png',
        },
        {
          contentType: 'application/vnd.microsoft.teams.file.download.info',
          name: 'report.txt',
          content: {
            downloadUrl: 'https://download.test/file.txt',
            uniqueId: 'file-1',
            fileType: 'txt',
          },
        },
      ],
      fetchImpl: fetchImpl as typeof fetch,
      getBotToken,
    });

    expect(getBotToken).toHaveBeenCalledTimes(1);
    expect(persistRuntimeAsset).toHaveBeenCalledTimes(2);
    expect(result.runtimeAssets).toHaveLength(2);
    expect(result.runtimeAssets[0]?.source.attachmentKind).toBe('inline-image');
    expect(result.runtimeAssets[1]?.source.attachmentKind).toBe('file-download');
    expect(result.imageUrls).toHaveLength(1);
    expect(result.imageUrls[0]).toContain('data:image/png;base64,');
    expect(result.notices).toEqual([]);
  });

  it('records an explicit notice when an attachment exceeds the runtime attachment size cap', async () => {
    const { ingestTeamsAttachments, persistRuntimeAsset } = await loadModule();
    const oversized = Buffer.alloc((10 * 1024 * 1024) + 1, 1);

    const result = await ingestTeamsAttachments({
      userId: 'user-2',
      correlationId: 'corr-2',
      attachments: [
        {
          contentType: 'application/pdf',
          contentUrl: 'https://files.test/big.pdf',
          name: 'big.pdf',
        },
      ],
      fetchImpl: vi.fn(async () => new Response(oversized, { status: 200 })) as typeof fetch,
    });

    expect(persistRuntimeAsset).not.toHaveBeenCalled();
    expect(result.runtimeAssets).toEqual([]);
    expect(result.imageUrls).toEqual([]);
    expect(result.notices[0]).toContain('exceeds the 10485760 byte runtime attachment limit');
  });

  it('builds a prompt-safe block from runtime assets and notices', async () => {
    const { buildInboundAttachmentPromptBlock } = await loadModule();

    const block = buildInboundAttachmentPromptBlock([
      {
        version: 1,
        id: '11111111-1111-4111-8111-111111111111',
        userId: 'user-1',
        correlationId: 'corr-3',
        kind: 'document',
        contentType: 'application/pdf',
        fileName: 'paper.pdf',
        byteLength: 1234,
        sha256: 'b'.repeat(64),
        source: {
          channel: 'teams',
          attachmentKind: 'file-download',
        },
        createdAt: '2026-03-31T00:00:00.000Z',
        expiresAt: '2026-03-31T06:00:00.000Z',
        ttlSeconds: 21600,
        storage: {
          container: 'helkinswarm-runtime-assets',
          payloadBlobPath: 'payload/paper.pdf',
          metadataBlobPath: 'metadata/paper.pdf.json',
        },
      },
    ], ['Skipped attachment `big.zip`: too large.']);

    expect(block).toContain('Inbound runtime assets for this turn');
    expect(block).toContain('Attachment kind: file-download');
    expect(block).toContain('Attachment ingestion notices');
    expect(block).toContain('Skipped attachment `big.zip`: too large.');
  });
});