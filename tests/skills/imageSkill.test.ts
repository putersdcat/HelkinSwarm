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

const identityHarness = vi.hoisted(() => ({
  getBearerToken: vi.fn(),
}));

const envConfigHarness = vi.hoisted(() => ({
  getEnvConfig: vi.fn(),
}));

vi.mock('../../src/integrations/runtimeAssetStore.js', () => ({
  persistRuntimeAsset: runtimeAssetHarness.persistRuntimeAsset,
}));

vi.mock('../../src/auth/identity.js', () => ({
  getBearerToken: identityHarness.getBearerToken,
}));

vi.mock('../../src/config/envConfig.js', () => ({
  getEnvConfig: envConfigHarness.getEnvConfig,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_FOUNDRY_ENDPOINT = 'https://helkinswarm-ai-t.services.ai.azure.com';
const MOCK_BEARER_TOKEN = 'mock-azure-token-xyz';

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
  delete process.env['AZURE_DALL_E_DEPLOYMENT'];
});

beforeEach(() => {
  runtimeAssetHarness.persistRuntimeAsset.mockReset();
  runtimeAssetHarness.persistRuntimeAsset.mockResolvedValue(MOCK_ASSET_REFERENCE);

  identityHarness.getBearerToken.mockReset();
  identityHarness.getBearerToken.mockResolvedValue(MOCK_BEARER_TOKEN);

  envConfigHarness.getEnvConfig.mockReset();
  envConfigHarness.getEnvConfig.mockReturnValue({
    azureAiFoundryEndpoint: MOCK_FOUNDRY_ENDPOINT,
  });
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('image_generate — happy path', () => {
  it('calls Azure AI Services DALL-E endpoint and returns assetId', async () => {
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
    expect(result['model']).toBe('azure:dall-e-3');
    expect(result['size']).toBe('1024x1024');
    expect((result['message'] as string)).toContain(MOCK_ASSET_REFERENCE.id);
  });

  it('calls correct Azure endpoint URL with default deployment', async () => {
    const mockFetch = makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await image_generate({
      prompt: 'sunset over mountains',
      userId: 'user-1',
      correlationId: 'corr-2',
    });

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      `${MOCK_FOUNDRY_ENDPOINT}/openai/deployments/dall-e-3/images/generations?api-version=2024-10-21`,
    );
  });

  it('uses AZURE_DALL_E_DEPLOYMENT env var when set', async () => {
    process.env['AZURE_DALL_E_DEPLOYMENT'] = 'my-dalle-deployment';

    const mockFetch = makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const result = await image_generate({ prompt: 'test', userId: 'user-1' }) as Record<string, unknown>;
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toContain('/openai/deployments/my-dalle-deployment/');
    expect(result['model']).toBe('azure:my-dalle-deployment');
  });

  it('passes correct request body to Azure DALL-E', async () => {
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

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.prompt).toBe('sunset over mountains');
    expect(body.size).toBe('1792x1024');
    expect(body.style).toBe('natural');
    expect(body.quality).toBe('hd');
    expect(body.response_format).toBe('b64_json');
    expect(body.n).toBe(1);
  });

  it('sends managed identity bearer token as Authorization header', async () => {
    const mockFetch = makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await image_generate({ prompt: 'test', userId: 'user-1' });

    const headers = mockFetch.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${MOCK_BEARER_TOKEN}`);
    // Verify we requested the correct scope
    expect(identityHarness.getBearerToken).toHaveBeenCalledWith(
      'https://cognitiveservices.azure.com/.default',
    );
  });

  it('includes revised_prompt in result when model changes the prompt', async () => {
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

  it('does not include revisedPrompt when revised prompt is identical to original', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG, revised_prompt: 'red fox in snow' }] },
    }));

    const result = await image_generate({
      prompt: 'red fox in snow',
      userId: 'user-1',
    }) as Record<string, unknown>;

    expect(result['revisedPrompt']).toBeUndefined();
  });

  it('persists decoded PNG bytes to runtime asset store', async () => {
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
    expect(call.contentType).toBe('image/png');
    expect(call.source.toolName).toBe('image_generate');
    expect(call.bytes).toBeInstanceOf(Uint8Array);
    expect(call.bytes).toEqual(Buffer.from(MOCK_B64_PNG, 'base64'));
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('image_generate — error paths', () => {
  it('throws when AZURE_AI_FOUNDRY_ENDPOINT is missing', async () => {
    envConfigHarness.getEnvConfig.mockReturnValue({ azureAiFoundryEndpoint: undefined });

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/AZURE_AI_FOUNDRY_ENDPOINT/);
  });

  it('throws on non-OK HTTP response from Azure (400)', async () => {
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

  it('throws on 429 rate limit from Azure', async () => {
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

  it('throws when API returns empty data array', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [] },
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/empty data array/);
  });

  it('throws when API returns data without b64_json', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ url: 'https://example.com/image.png' }] },
    }));

    await expect(
      image_generate({ prompt: 'test', userId: 'user-1' }),
    ).rejects.toThrow(/b64_json/);
  });

  it('throws when persistRuntimeAsset returns null (storage unavailable)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('image_generate — defaults', () => {
  it('defaults size to 1024x1024', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    }));

    const result = await image_generate({ prompt: 'test', userId: 'user-1' }) as Record<string, unknown>;
    expect(result['size']).toBe('1024x1024');

    const body = JSON.parse((vi.mocked(globalThis.fetch).mock.calls[0]![1]).body as string);
    expect(body.size).toBe('1024x1024');
    expect(body.style).toBe('vivid');
    expect(body.quality).toBe('standard');
  });

  it('accepts landscape size', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    }));

    const result = await image_generate({
      prompt: 'test',
      size: '1792x1024',
      userId: 'user-1',
    }) as Record<string, unknown>;
    expect(result['size']).toBe('1792x1024');
  });

  it('includes contentType image/png in result', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(makeFetchMock({
      body: { data: [{ b64_json: MOCK_B64_PNG }] },
    }));

    const result = await image_generate({ prompt: 'test', userId: 'user-1' }) as Record<string, unknown>;
    expect(result['contentType']).toBe('image/png');
  });
});

