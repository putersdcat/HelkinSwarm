import { afterEach, describe, expect, it, vi } from 'vitest';

const runtimeAssetHarness = vi.hoisted(() => ({
  persistRuntimeAsset: vi.fn(),
  readRuntimeAssetContent: vi.fn(),
}));

vi.mock('../../src/integrations/runtimeAssetStore.js', () => ({
  persistRuntimeAsset: runtimeAssetHarness.persistRuntimeAsset,
  readRuntimeAssetContent: runtimeAssetHarness.readRuntimeAssetContent,
}));

async function loadHandlersModule() {
  vi.resetModules();

  runtimeAssetHarness.persistRuntimeAsset.mockReset();
  runtimeAssetHarness.readRuntimeAssetContent.mockReset();

  runtimeAssetHarness.persistRuntimeAsset.mockImplementation(async (input: {
    userId: string;
    correlationId: string;
    contentType: string;
    fileName?: string;
    bytes: Uint8Array;
    source: {
      channel: 'outlook';
      attachmentKind?: 'inline-image' | 'file-download' | 'generic-attachment';
      messageId?: string;
      externalId?: string;
      detail?: string;
    };
    summary?: string;
  }) => ({
    version: 1 as const,
    id: 'asset-ref-1',
    userId: input.userId,
    correlationId: input.correlationId,
    kind: input.contentType.startsWith('image/') ? 'image' as const : 'file' as const,
    contentType: input.contentType,
    ...(input.fileName ? { fileName: input.fileName } : {}),
    byteLength: input.bytes.byteLength,
    sha256: 'd'.repeat(64),
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
  runtimeAssetHarness.readRuntimeAssetContent.mockResolvedValue(null);

  const mod = await import('../../skills/outlook/handlers.js');
  return { ...mod, persistRuntimeAsset: runtimeAssetHarness.persistRuntimeAsset };
}

describe('outlook attachment handlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env['AZURE_CONTENT_SAFETY_ENDPOINT'];
    delete process.env['AZURE_CONTENT_SAFETY_KEY'];
  });

  it('lists attachment metadata and maps inline cid references from the message body', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg-1',
          body: {
            contentType: 'html',
            content: '<html><body><img src="cid:inline-1" /></body></html>',
          },
          hasAttachments: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              '@odata.type': '#microsoft.graph.fileAttachment',
              id: 'att-inline',
              name: 'inline.png',
              contentType: 'image/png',
              size: 128,
              isInline: true,
              contentId: 'inline-1',
              lastModifiedDateTime: '2026-03-31T00:00:00Z',
            },
            {
              '@odata.type': '#microsoft.graph.fileAttachment',
              id: 'att-file',
              name: 'report.pdf',
              contentType: 'application/pdf',
              size: 2048,
              isInline: false,
              lastModifiedDateTime: '2026-03-31T00:01:00Z',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await loadHandlersModule();
    const result = await handlers['outlook_list_attachments']({
      userId: 'user-1',
      messageId: 'msg-1',
      _scopedToken: 'scoped-test-token',
      correlationId: 'corr-attachments',
    }) as {
      messageId: string;
      bodyCidReferences: string[];
      attachments: Array<{ id: string; attachmentKind: string; cidReferencedInBody: boolean; downloadSupported: boolean }>;
    };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/me/messages/msg-1?$select=id,body,hasAttachments');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/me/messages/msg-1/attachments?$top=100');
    expect(fetchMock.mock.calls[1]?.[0]).not.toContain('$select=');
    expect(result.messageId).toBe('msg-1');
    expect(result.bodyCidReferences).toContain('inline-1');
    expect(result.attachments).toEqual([
      expect.objectContaining({
        id: 'att-inline',
        attachmentKind: 'inline-image',
        cidReferencedInBody: true,
        downloadSupported: true,
      }),
      expect.objectContaining({
        id: 'att-file',
        attachmentKind: 'file-download',
        cidReferencedInBody: false,
        downloadSupported: true,
      }),
    ]);
  });

  it('downloads a file attachment into runtime asset storage', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg-2',
          body: {
            contentType: 'html',
            content: '<html><body><img src="cid:inline-2" /></body></html>',
          },
          hasAttachments: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              '@odata.type': '#microsoft.graph.fileAttachment',
              id: 'att-inline',
              name: 'inline.png',
              contentType: 'image/png',
              size: 128,
              isInline: true,
              contentId: 'inline-2',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          id: 'att-inline',
          name: 'inline.png',
          contentType: 'image/png',
          size: 128,
          isInline: true,
          contentId: 'inline-2',
          contentBytes: Buffer.from([137, 80, 78, 71]).toString('base64'),
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { handlers, persistRuntimeAsset } = await loadHandlersModule();
    const result = await handlers['outlook_download_attachment']({
      userId: 'user-1',
      messageId: 'msg-2',
      attachmentId: 'att-inline',
      _scopedToken: 'scoped-test-token',
      correlationId: 'corr-download',
    }) as {
      attachment: { attachmentKind: string; contentId: string | null };
      runtimeAsset: { id: string; contentType: string; fileName?: string };
    };

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/me/messages/msg-2/attachments/att-inline');
    expect(fetchMock.mock.calls[2]?.[0]).not.toContain('$select=');
    expect(persistRuntimeAsset).toHaveBeenCalledTimes(1);
    expect(persistRuntimeAsset).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      correlationId: 'corr-download',
      contentType: 'image/png',
      fileName: 'inline.png',
      source: expect.objectContaining({
        channel: 'outlook',
        attachmentKind: 'inline-image',
        messageId: 'msg-2',
        externalId: 'att-inline',
      }),
    }));
    expect(result.attachment).toMatchObject({
      attachmentKind: 'inline-image',
      contentId: 'inline-2',
    });
    expect(result.runtimeAsset).toMatchObject({
      id: 'asset-ref-1',
      contentType: 'image/png',
      fileName: 'inline.png',
    });
  });

  it('includes attachment metadata in outlook_read_email results', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg-3',
          subject: 'Attachment-bearing mail',
          body: {
            contentType: 'html',
            content: '<html><body><img src="cid:inline-3" /></body></html>',
          },
          from: { emailAddress: { address: 'alice@example.com' } },
          toRecipients: [],
          ccRecipients: [],
          receivedDateTime: '2026-03-31T01:00:00Z',
          hasAttachments: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'msg-3',
          body: {
            contentType: 'html',
            content: '<html><body><img src="cid:inline-3" /></body></html>',
          },
          hasAttachments: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              '@odata.type': '#microsoft.graph.fileAttachment',
              id: 'att-read',
              name: 'inline-read.png',
              contentType: 'image/png',
              size: 64,
              isInline: true,
              contentId: 'inline-3',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await loadHandlersModule();
    const result = await handlers['outlook_read_email']({
      userId: 'user-1',
      messageId: 'msg-3',
      _scopedToken: 'scoped-test-token',
      correlationId: 'corr-read',
    }) as {
      hasAttachments?: boolean;
      attachments?: Array<{ id: string; cidReferencedInBody: boolean }>;
      bodyCidReferences?: string[];
    };

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.hasAttachments).toBe(true);
    expect(result.bodyCidReferences).toContain('inline-3');
    expect(result.attachments).toEqual([
      expect.objectContaining({
        id: 'att-read',
        cidReferencedInBody: true,
      }),
    ]);
  });
});