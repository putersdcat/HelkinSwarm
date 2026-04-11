// Tests for image generation skill handler
// Issue: #241 — rewritten for OpenRouter backend (DALL-E 3 not available in eastus2)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { image_generate, extractBase64FromDataUrl } from '../../skills/image/handlers.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const runtimeAssetHarness = vi.hoisted(() => ({
  persistRuntimeAsset: vi.fn(),
}));

const envConfigHarness = vi.hoisted(() => ({
  getEnvConfig: vi.fn(),
}));

vi.mock('../../src/integrations/runtimeAssetStore.js', () => ({
  persistRuntimeAsset: runtimeAssetHarness.persistRuntimeAsset,
}));

vi.mock('../../src/config/envConfig.js', () => ({
  getEnvConfig: envConfigHarness.getEnvConfig,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_OPENROUTER_KEY = 'sk-or-test-mock-key';

const MOCK_ASSET_REFERENCE = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  userId: 'user-1',
  correlationId: 'corr-1',
  kind: 'image',
  contentType: 'image/png',
  fileName: 'openai-gpt-5-image-mini-corr-1.png',
  byteLength: 1024,
  sha256: 'abc123',
  source: { channel: 'tool', toolName: 'image_generate' },
  createdAt: '2026-04-11T00:00:00Z',
  expiresAt: '2026-04-12T00:00:00Z',
  ttlSeconds: 86400,
  version: 1,
  storage: {
    container: 'helkinswarm-runtime-assets',
    payloadBlobPath: 'runtime-assets/user-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/payload.bin',
    metadataBlobPath: 'runtime-assets/user-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/metadata.json',
  },
};

// Minimal PNG header bytes encoded as base64 for testing
const MOCK_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MOCK_PNG_B64 = MOCK_PNG_BYTES.toString('base64');
const MOCK_IMAGE_DATA_URL = `data:image/png;base64,${MOCK_PNG_B64}`;

/** Build an OpenRouter chat completions response with images */
function makeOpenRouterImageResponse(dataUrl?: string, model = 'openai/gpt-5-image-mini') {
  return {
    id: 'gen-test-abc123',
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Here is your generated image.',
          images: dataUrl ? [{ image_url: { url: dataUrl } }] : [],
        },
      },
    ],
    model,
  };
}

function makeFetchMock(options: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  errorText?: string;
}) {
  const { ok = true, status = 200, statusText = 'OK', body, errorText = '' } = options;
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(errorText),
  } as unknown as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['IMAGE_MODEL'];
});

beforeEach(() => {
  runtimeAssetHarness.persistRuntimeAsset.mockReset();
  runtimeAssetHarness.persistRuntimeAsset.mockResolvedValue(MOCK_ASSET_REFERENCE);

  envConfigHarness.getEnvConfig.mockReset();
  envConfigHarness.getEnvConfig.mockReturnValue({
    openrouterApiKey: MOCK_OPENROUTER_KEY,
  });
});

// ---------------------------------------------------------------------------
// Unit test for extractBase64FromDataUrl helper
// ---------------------------------------------------------------------------

describe('extractBase64FromDataUrl', () => {
  it('extracts png mime type and bytes from data URL', () => {
    const { mimeType, bytes } = extractBase64FromDataUrl(MOCK_IMAGE_DATA_URL);
    expect(mimeType).toBe('image/png');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes).equals(MOCK_PNG_BYTES)).toBe(true);
  });

  it('handles webp mime type', () => {
    const webpB64 = Buffer.from([0x52, 0x49, 0x46, 0x46]).toString('base64');
    const { mimeType } = extractBase64FromDataUrl(`data:image/webp;base64,${webpB64}`);
    expect(mimeType).toBe('image/webp');
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('image_generate — happy path', () => {
  it('calls OpenRouter completions endpoint and returns assetId', async () => {
    const mockFetch = makeFetchMock({
      body: makeOpenRouterImageResponse(MOCK_IMAGE_DATA_URL),
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const result = await image_generate({
      prompt: 'a red fox running through a snowy forest',
      userId: 'user-1',
      correlationId: 'corr-test-1',
    }) as Record<string, unknown>;

    expect(result['assetId']).toBe(MOCK_ASSET_REFERENCE.id);
    expect(result['model']).toBe('openai/gpt-5-image-mini');
    expect((result['message'] as string)).toContain(MOCK_ASSET_REFERENCE.id);
  });

  it('calls the correct OpenRouter completions URL', async () => {
    const mockFetch = makeFetchMock({
      body: makeOpenRouterImageResponse(MOCK_IMAGE_DATA_URL),
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await image_generate({ prompt: 'sunset', userId: 'user-1', correlationId: 'corr-2' });

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('sends OPENROUTER_API_KEY as Authorization header', async () => {
    const mockFetch = makeFetchMock({
      body: makeOpenRouterImageResponse(MOCK_IMAGE_DATA_URL),
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await image_generate({ prompt: 'test', userId: 'user-1' });

    const headers = mockFetch.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${MOCK_OPENROUTER_KEY}`);
  });

  it('sends modalities:[image,text] in the request body', async () => {
    const mockFetch = makeFetchMock({
      body: makeOpenRouterImageResponse(MOCK_IMAGE_DATA_URL),
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await image_generate({ prompt: 'sunset over mountains', userId: 'user-1', correlationId: 'c' });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.modalities).toEqual(['image', 'text']);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toBe('sunset over mountains');
  });

  it('uses IMAGE_MODEL env var when set', async () => {
    process.env['IMAGE_MODEL'] = 'google/gemini-2.5-flash-image';
    const mockFetch = makeFetchMock({
      body: makeOpenRouterImageResponse(MOCK_IMAGE_DATA_URL, 'google/gemini-2.5-flash-image'),
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const result = await image_generate({ prompt: 'test', userId: 'user-1' }) as Record<string, unknown>;
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.model).toBe('google/gemini-2.5-flash-image');
    expect(result['model']).toBe('google/gemini-2.5-flash-image');
  });

  it('persists decoded bytes to runtime asset store with correct shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: makeOpenRouterImageResponse(MOCK_IMAGE_DATA_URL),
    }));

    await image_generate({
      prompt: 'test image',
      userId: 'user-42',
      correlationId: 'corr-xyz',
    });

    expect(runtimeAssetHarness.persistRuntimeAsset).toHaveBeenCalledOnce();
    const call = runtimeAssetHarness.persistRuntimeAsset.mock.calls[0]![0];
    expect(call.userId).toBe('user-42');
    expect(call.correlationId).toBe('corr-xyz');
    expect(call.kind).toBe('image');
    expect(call.contentType).toBe('image/png');
    expect(call.source.toolName).toBe('image_generate');
    expect(call.bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(call.bytes as Uint8Array).equals(MOCK_PNG_BYTES)).toBe(true);
  });

  it('includes contentType in result matching the data URL mime type', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: makeOpenRouterImageResponse(MOCK_IMAGE_DATA_URL),
    }));

    const result = await image_generate({ prompt: 'test', userId: 'user-1' }) as Record<string, unknown>;
    expect(result['contentType']).toBe('image/png');
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('image_generate — error paths', () => {
  it('throws when OPENROUTER_API_KEY is missing', async () => {
    envConfigHarness.getEnvConfig.mockReturnValue({ openrouterApiKey: undefined });

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('throws on non-OK HTTP response (400)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      errorText: '{"error": {"code": "contentFilter"}}',
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/Image generation failed: 400/);
  });

  it('throws on 429 rate limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      errorText: '{"error": {"code": "429"}}',
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/429/);
  });

  it('throws when API returns no images in the choices message', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: makeOpenRouterImageResponse(undefined),
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/no images/);
  });

  it('throws when choices array is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { id: 'gen-x', choices: [], model: 'openai/gpt-5-image-mini' },
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow();
  });

  it('throws when persistRuntimeAsset returns null (storage unavailable)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: makeOpenRouterImageResponse(MOCK_IMAGE_DATA_URL),
    }));
    runtimeAssetHarness.persistRuntimeAsset.mockResolvedValue(null);

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/persist.*image/i);
  });

  it('rejects prompt exceeding 4000 chars', async () => {
    await expect(
      image_generate({ prompt: 'a'.repeat(4001), userId: 'user-1' }),
    ).rejects.toThrow();
  });

  it('rejects missing userId', async () => {
    await expect(
      image_generate({ prompt: 'test image' }),
    ).rejects.toThrow();
  });

  it('rejects empty prompt', async () => {
    await expect(
      image_generate({ prompt: '', userId: 'user-1' }),
    ).rejects.toThrow();
  });
});

