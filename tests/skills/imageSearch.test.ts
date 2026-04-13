// Tests for image_search tool handler — Brave image search + DuckDuckGo fallback.
// Issue: #631 (Phase S2 — tool surface expansion)

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fetch and environment before importing handlers
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// We need to mock the modules that image_generate depends on so loading handlers.ts doesn't fail
const runtimeAssetHarness = vi.hoisted(() => ({
  persistRuntimeAsset: vi.fn(),
}));
const envConfigHarness = vi.hoisted(() => ({
  getEnvConfig: vi.fn().mockReturnValue({ openrouterApiKey: 'mock-key' }),
}));

vi.mock('../../src/integrations/runtimeAssetStore.js', () => ({
  persistRuntimeAsset: runtimeAssetHarness.persistRuntimeAsset,
}));
vi.mock('../../src/config/envConfig.js', () => ({
  getEnvConfig: envConfigHarness.getEnvConfig,
}));

async function loadHandlers() {
  vi.resetModules();
  return await import('../../skills/image/handlers.js');
}

describe('image_search', () => {
  beforeEach(() => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'test-brave-key');
  });

  afterEach(() => {
    mockFetch.mockReset();
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  it('rejects empty query', async () => {
    const { image_search } = await loadHandlers();
    await expect(image_search({ query: '' })).rejects.toThrow('Search query is required');
    await expect(image_search({})).rejects.toThrow('Search query is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Brave Search API path
  // -------------------------------------------------------------------------

  it('calls Brave image search API with correct parameters', async () => {
    const { image_search } = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Cat Photo',
            url: 'https://example.com/cat',
            source: 'Example',
            thumbnail: { src: 'https://example.com/cat-thumb.jpg' },
          },
        ],
      }),
    });

    await image_search({ query: 'cute cats', count: 3 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('api.search.brave.com/res/v1/images/search');
    expect(String(url)).toContain('q=cute+cats');
    expect(String(url)).toContain('count=3');
    expect(opts.headers['X-Subscription-Token']).toBe('test-brave-key');
  });

  it('formats Brave results with title, URL, and thumbnail', async () => {
    const { image_search } = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Mountain Photo',
            url: 'https://example.com/mountain',
            source: 'Nature.com',
            thumbnail: { src: 'https://example.com/thumb.jpg' },
          },
          {
            title: 'Lake View',
            url: 'https://example.com/lake',
            properties: { url: 'https://example.com/lake-full.jpg' },
          },
        ],
      }),
    });

    const result = String(await image_search({ query: 'mountain landscape' }));
    expect(result).toContain('🖼️ **Image search: "mountain landscape"**');
    expect(result).toContain('[Mountain Photo](https://example.com/mountain)');
    expect(result).toContain('_(Nature.com)_');
    expect(result).toContain('Thumbnail: https://example.com/thumb.jpg');
    expect(result).toContain('[Lake View](https://example.com/lake)');
  });

  it('returns no-results message when API returns empty', async () => {
    const { image_search } = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const result = String(await image_search({ query: 'nonexistent-thing-12345' }));
    expect(result).toContain('No image results found');
  });

  it('propagates Brave API errors', async () => {
    const { image_search } = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'rate limited',
    });

    await expect(image_search({ query: 'test' })).rejects.toThrow('Brave Image Search API error: 429');
  });

  // -------------------------------------------------------------------------
  // DuckDuckGo fallback
  // -------------------------------------------------------------------------

  it('falls back to DuckDuckGo when Brave key is not configured', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    const { image_search } = await loadHandlers();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'DDG Image',
            url: 'https://example.com/ddg',
            image: 'https://example.com/ddg-full.jpg',
            thumbnail: 'https://example.com/ddg-thumb.jpg',
          },
        ],
      }),
    });

    const result = String(await image_search({ query: 'cats' }));
    expect(result).toContain('DuckDuckGo fallback');
    expect(result).toContain('[DDG Image]');

    const [url] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('api.duckduckgo.com');
  });

  // -------------------------------------------------------------------------
  // Count parameter clamping
  // -------------------------------------------------------------------------

  it('clamps count between 1 and 10', async () => {
    const { image_search } = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    await image_search({ query: 'test', count: 50 });
    const url = String(mockFetch.mock.calls[0]![0]);
    expect(url).toContain('count=10');
  });
});
