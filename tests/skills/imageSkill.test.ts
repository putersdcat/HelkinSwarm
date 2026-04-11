// Tests for image generation skill handler
// Issue: #241

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { image_generate } from '../../skills/image/handlers.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const runtimeAssetHarness = vi.hoisted(() => ({
  persistRuntimeAsset: vi.fn(),
}));

vi.mock('../../src/integrations/runtimeAssetStore.js', () => ({
  persistRuntimeAsset: runtimeAssetHarness.persistRuntimeAsset,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_ASSET_REFERENCE = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  userId: 'user-1',
  correlationId: 'corr-1',
  kind: 'image',
  contentType: 'image/png',
  fileName: 'dall-e-3-1024x1024-corr-1.png',
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

const MOCK_B64_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

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
  delete process.env['OPENROUTER_API_KEY'];
  delete process.env['IMAGE_GENERATION_MODEL'];
});

beforeEach(() => {
  runtimeAssetHarness.persistRuntimeAsset.mockReset();
  runtimeAssetHarness.persistRuntimeAsset.mockResolvedValue(MOCK_ASSET_REFERENCE);
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('image_generate — happy path', () => {
  it('calls OpenRouter images endpoint and returns assetId', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    const mockFetch = makeFetchMock({
      body: {
        created: 1234567890,
        data: [{ b64_json: MOCK_B64_PNG, revised_prompt: undefined }],
      },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const result = await image_generate({
      prompt: 'a red fox running through a snowy forest',
      userId: 'user-1',
      correlationId: 'corr-test-1',
    }) as Record<string, unknown>;

    expect(result['assetId']).toBe(MOCK_ASSET_REFERENCE.id);
    expect(result['model']).toBe('openai/dall-e-3');
    expect(result['size']).toBe('1024x1024');
    expect((result['message'] as string)).toContain(MOCK_ASSET_REFERENCE.id);
  });

  it('passes correct request body for DALL-E model', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    const mockFetch = makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await image_generate({
      prompt: 'sunset over mountains',
      size: '1792x1024',
      style: 'natural',
      quality: 'hd',
      userId: 'user-1',
      correlationId: 'corr-2',
    });

    const lastCall = mockFetch.mock.calls[0];
    expect(lastCall).toBeDefined();
    const [url, options] = lastCall!;
    expect(url).toBe('https://openrouter.ai/api/v1/images/generations');
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('openai/dall-e-3');
    expect(body.size).toBe('1792x1024');
    expect(body.style).toBe('natural');
    expect(body.quality).toBe('hd');
    expect(body.response_format).toBe('b64_json');
    expect(body.n).toBe(1);
  });

  it('omits DALL-E-specific params for non-DALL-E models', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    const mockFetch = makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await image_generate({
      prompt: 'abstract art',
      model: 'black-forest-labs/flux-1.1-pro',
      userId: 'user-1',
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.style).toBeUndefined();
    expect(body.quality).toBeUndefined();
    expect(body.size).toBeUndefined();
    expect(body.model).toBe('black-forest-labs/flux-1.1-pro');
  });

  it('includes revised_prompt in result when model changes the prompt', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    const revisedPrompt = 'a majestic red fox leaping through powder snow in a pine forest';
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG, revised_prompt: revisedPrompt }] },
    }));

    const result = await image_generate({
      prompt: 'red fox in snow',
      userId: 'user-1',
    }) as Record<string, unknown>;

    expect(result['revisedPrompt']).toBe(revisedPrompt);
    expect((result['message'] as string)).toContain('revised');
  });

  it('does not include revisedPrompt when prompt is identical', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG, revised_prompt: 'red fox in snow' }] },
    }));

    const result = await image_generate({
      prompt: 'red fox in snow',
      userId: 'user-1',
    }) as Record<string, unknown>;

    expect(result['revisedPrompt']).toBeUndefined();
  });

  it('persists decoded bytes to runtime asset store', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
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
    expect(call.source.toolName).toBe('image_generate');
    expect(call.bytes).toBeInstanceOf(Uint8Array);
    expect(call.bytes).toEqual(Buffer.from(MOCK_B64_PNG, 'base64'));
  });

  it('uses IMAGE_GENERATION_MODEL env var as model override', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    process.env['IMAGE_GENERATION_MODEL'] = 'openai/dall-e-2';

    const mockFetch = makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const result = await image_generate({ prompt: 'test', userId: 'user-1' }) as Record<string, unknown>;
    expect(result['model']).toBe('openai/dall-e-2');
  });

  it('model arg overrides IMAGE_GENERATION_MODEL env var', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    process.env['IMAGE_GENERATION_MODEL'] = 'openai/dall-e-2';

    const mockFetch = makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const result = await image_generate({
      prompt: 'test',
      model: 'black-forest-labs/flux-1.1-pro',
      userId: 'user-1',
    }) as Record<string, unknown>;
    expect(result['model']).toBe('black-forest-labs/flux-1.1-pro');
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('image_generate — error paths', () => {
  it('throws when OPENROUTER_API_KEY is missing', async () => {
    delete process.env['OPENROUTER_API_KEY'];

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('throws on non-OK HTTP response from OpenRouter', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      errorText: '{"error": "content policy violation"}',
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/Image generation failed: 400/);
  });

  it('throws on 429 rate limit from OpenRouter', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      errorText: '{"error": "rate limit exceeded"}',
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/429/);
  });

  it('throws when API returns empty data array', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [] },
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/empty data array/);
  });

  it('throws when API returns data without b64_json', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ url: 'https://cdn.openrouter.ai/img/abc.png' }] },
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/b64_json/);
  });

  it('rejects prompt exceeding 4000 chars', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    await expect(
      image_generate({ prompt: 'a'.repeat(4001), userId: 'user-1' }),
    ).rejects.toThrow();
  });

  it('rejects missing userId', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    await expect(
      image_generate({ prompt: 'test image' }),
    ).rejects.toThrow();
  });

  it('rejects empty prompt', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    await expect(
      image_generate({ prompt: '', userId: 'user-1' }),
    ).rejects.toThrow();
  });

  it('throws when persistRuntimeAsset returns null (storage unavailable)', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    }));
    runtimeAssetHarness.persistRuntimeAsset.mockResolvedValue(null);

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/persist.*image/i);
  });
});

// ---------------------------------------------------------------------------
// Content type inference
// ---------------------------------------------------------------------------

describe('image_generate — content type inference', () => {
  it('assigns image/png for DALL-E models', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    }));

    await image_generate({ prompt: 'test', userId: 'user-1' });

    const call = runtimeAssetHarness.persistRuntimeAsset.mock.calls[0]![0];
    expect(call.contentType).toBe('image/png');
  });

  it('assigns image/webp for FLUX models', async () => {
    process.env['OPENROUTER_API_KEY'] = 'test-key';

    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    }));

    await image_generate({
      prompt: 'test',
      model: 'black-forest-labs/flux-1.1-pro',
      userId: 'user-1',
    });

    const call = runtimeAssetHarness.persistRuntimeAsset.mock.calls[0]![0];
    expect(call.contentType).toBe('image/webp');
  });
});

// ---------------------------------------------------------------------------
// Authorization header
// ---------------------------------------------------------------------------

describe('image_generate — auth header', () => {
  it('sends Authorization: Bearer <key> header', async () => {
    process.env['OPENROUTER_API_KEY'] = 'my-secret-key-123';

    const mockFetch = makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await image_generate({ prompt: 'test', userId: 'user-1' });

    const headers = mockFetch.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-key-123');
  });
});
