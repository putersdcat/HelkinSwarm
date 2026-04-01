import { afterEach, describe, expect, it, vi } from 'vitest';

const INLINE_ASSET_ID = '11111111-1111-1111-1111-111111111111';
const FILE_ASSET_ID = '22222222-2222-2222-2222-222222222222';
const TEXT_ASSET_ID = '33333333-3333-3333-3333-333333333333';

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

  runtimeAssetHarness.readRuntimeAssetContent.mockImplementation(async ({ assetId }: { assetId: string }) => {
    if (assetId === INLINE_ASSET_ID) {
      return {
        reference: {
          id: INLINE_ASSET_ID,
          userId: 'user-1',
          contentType: 'image/png',
          fileName: 'robotlove.png',
        },
        content: Buffer.from([137, 80, 78, 71]),
      };
    }

    if (assetId === FILE_ASSET_ID) {
      return {
        reference: {
          id: FILE_ASSET_ID,
          userId: 'user-1',
          contentType: 'application/pdf',
          fileName: 'report.pdf',
        },
        content: Buffer.from('%PDF-1.7'),
      };
    }

    if (assetId === TEXT_ASSET_ID) {
      return {
        reference: {
          id: TEXT_ASSET_ID,
          userId: 'user-1',
          contentType: 'text/plain',
          fileName: 'notes.txt',
        },
        content: Buffer.from('hello world'),
      };
    }

    return null;
  });

  const mod = await import('../../skills/outlook/handlers.js');
  return {
    ...mod,
    persistRuntimeAsset: runtimeAssetHarness.persistRuntimeAsset,
    readRuntimeAssetContent: runtimeAssetHarness.readRuntimeAssetContent,
  };
}

describe('outlook_send_email runtime-asset attachments', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    runtimeAssetHarness.persistRuntimeAsset.mockReset();
    runtimeAssetHarness.readRuntimeAssetContent.mockReset();
  });

  it('rejects cid-based inline image HTML when no inline runtime assets are provided', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await loadHandlersModule();

    await expect(
      handlers['outlook_send_email']({
        userId: 'user-1',
        to: ['eric@example.com'],
        subject: 'Inline image attempt',
        bodyType: 'html',
        body: '<p>Hello</p><img src="cid:robotlove" />',
        _scopedToken: 'scoped-test-token',
        correlationId: 'corr-inline-guard',
      }),
    ).rejects.toThrow(/no inline runtime assets were supplied/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends inline runtime assets as Graph inline file attachments with matching content IDs', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { handlers, readRuntimeAssetContent } = await loadHandlersModule();

    const result = await handlers['outlook_send_email']({
      userId: 'user-1',
      to: ['eric@example.com'],
      subject: 'Inline asset email',
      bodyType: 'html',
      body: '<p>Hello</p><img src="cid:robotlove" />',
      inlineAssets: [{ assetId: INLINE_ASSET_ID, contentId: 'robotlove' }],
      _scopedToken: 'scoped-test-token',
      correlationId: 'corr-inline-send',
    }) as { success: boolean; message: string };

    expect(readRuntimeAssetContent).toHaveBeenCalledWith({ userId: 'user-1', assetId: INLINE_ASSET_ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body ?? '{}')) as {
      message: {
        attachments?: Array<{
          name: string;
          contentType: string;
          contentBytes: string;
          isInline: boolean;
          contentId?: string;
        }>;
      };
    };

    expect(payload.message.attachments).toEqual([
      expect.objectContaining({
        name: 'robotlove.png',
        contentType: 'image/png',
        contentBytes: Buffer.from([137, 80, 78, 71]).toString('base64'),
        isInline: true,
        contentId: 'robotlove',
      }),
    ]);
    expect(result).toEqual({ success: true, message: 'Email sent to eric@example.com' });
  });

  it('sends regular runtime asset attachments in the same sendMail call', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { handlers, readRuntimeAssetContent } = await loadHandlersModule();

    await handlers['outlook_send_email']({
      userId: 'user-1',
      to: ['eric@example.com'],
      subject: 'Attachment email',
      bodyType: 'text',
      body: 'Please see attached.',
      attachmentAssetIds: [FILE_ASSET_ID],
      _scopedToken: 'scoped-test-token',
      correlationId: 'corr-attachment-send',
    });

    expect(readRuntimeAssetContent).toHaveBeenCalledWith({ userId: 'user-1', assetId: FILE_ASSET_ID });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body ?? '{}')) as {
      message: {
        attachments?: Array<{
          name: string;
          contentType: string;
          contentBytes: string;
          isInline: boolean;
          contentId?: string;
        }>;
      };
    };

    expect(payload.message.attachments).toEqual([
      expect.objectContaining({
        name: 'report.pdf',
        contentType: 'application/pdf',
        contentBytes: Buffer.from('%PDF-1.7').toString('base64'),
        isInline: false,
      }),
    ]);
    expect(payload.message.attachments?.[0]).not.toHaveProperty('contentId');
  });

  it('rejects inline runtime assets whose content IDs do not match the HTML body', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await loadHandlersModule();

    await expect(
      handlers['outlook_send_email']({
        userId: 'user-1',
        to: ['eric@example.com'],
        subject: 'Inline mismatch',
        bodyType: 'html',
        body: '<p>Hello</p><img src="cid:hero-image" />',
        inlineAssets: [{ assetId: INLINE_ASSET_ID, contentId: 'robotlove' }],
        _scopedToken: 'scoped-test-token',
        correlationId: 'corr-inline-mismatch',
      }),
    ).rejects.toThrow(/matching inline runtime assets were not supplied/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-image runtime assets for inline embedding', async () => {
    process.env['AZURE_CONTENT_SAFETY_ENDPOINT'] = 'https://example.test';
    process.env['AZURE_CONTENT_SAFETY_KEY'] = 'test-key';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = await loadHandlersModule();

    await expect(
      handlers['outlook_send_email']({
        userId: 'user-1',
        to: ['eric@example.com'],
        subject: 'Inline wrong type',
        bodyType: 'html',
        body: '<p>Hello</p><img src="cid:notes" />',
        inlineAssets: [{ assetId: TEXT_ASSET_ID, contentId: 'notes' }],
        _scopedToken: 'scoped-test-token',
        correlationId: 'corr-inline-type',
      }),
    ).rejects.toThrow(/Only image runtime assets can be embedded inline right now/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});