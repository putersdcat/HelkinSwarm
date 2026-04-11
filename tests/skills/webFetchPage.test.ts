// Tests for web_fetch_page tool handler — SSRF guard, HTML extraction, error paths.
// Issue: #177 (web_fetch_page Phase 1 slice)

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

async function loadHandlers() {
  vi.resetModules();
  return await import('../../skills/web/handlers.js');
}

describe('web_fetch_page', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // SSRF guard
  // -------------------------------------------------------------------------

  it('blocks localhost without calling fetch', async () => {
    const { web_fetch_page } = await loadHandlers();
    await expect(web_fetch_page({ url: 'http://localhost/secret' })).rejects.toThrow('URL not allowed: localhost');
    await expect(web_fetch_page({ url: 'http://127.0.0.1/secret' })).rejects.toThrow('private/reserved IP range');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks Azure IMDS and link-local addresses without calling fetch', async () => {
    const { web_fetch_page } = await loadHandlers();
    await expect(web_fetch_page({ url: 'http://169.254.169.254/metadata/instance' })).rejects.toThrow('cloud metadata endpoint');
    await expect(web_fetch_page({ url: 'http://169.254.0.1/' })).rejects.toThrow('cloud metadata endpoint');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks private IPv4 ranges (10.x, 172.16-31.x, 192.168.x) without calling fetch', async () => {
    const { web_fetch_page } = await loadHandlers();
    await expect(web_fetch_page({ url: 'http://10.0.0.1/admin' })).rejects.toThrow('private/reserved IP range');
    await expect(web_fetch_page({ url: 'http://192.168.1.100/' })).rejects.toThrow('private/reserved IP range');
    await expect(web_fetch_page({ url: 'http://172.20.0.1/' })).rejects.toThrow('private/reserved IP range');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks non-HTTP schemes without calling fetch', async () => {
    const { web_fetch_page } = await loadHandlers();
    await expect(web_fetch_page({ url: 'file:///etc/passwd' })).rejects.toThrow('non-HTTP scheme');
    await expect(web_fetch_page({ url: 'ftp://example.com/data' })).rejects.toThrow('non-HTTP scheme');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects missing url argument without calling fetch', async () => {
    const { web_fetch_page } = await loadHandlers();
    await expect(web_fetch_page({})).rejects.toThrow('url is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // HTML extraction
  // -------------------------------------------------------------------------

  it('extracts readable text and strips scripts, styles, and tags from HTML', async () => {
    const { web_fetch_page } = await loadHandlers();
    const html = [
      '<html><head>',
      '<style>body { color: red; }</style>',
      '<script>alert("xss")</script>',
      '</head><body>',
      '<h1>Hello World</h1>',
      '<p>Some <b>bold</b> text.</p>',
      '<p>Second &amp; paragraph.</p>',
      '</body></html>',
    ].join('');

    const encoder = new TextEncoder();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/page',
      headers: { get: () => 'text/html; charset=utf-8' },
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: encoder.encode(html) })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });

    const result = String(await web_fetch_page({ url: 'https://example.com/page' }));
    expect(result).toContain('Hello World');
    expect(result).toContain('bold');
    expect(result).toContain('Second & paragraph');  // entity decoded
    expect(result).not.toContain('<h1>');
    expect(result).not.toContain('<b>');
    expect(result).not.toContain('alert');       // script content stripped
    expect(result).not.toContain('color: red'); // style content stripped
  });

  it('returns plain text as-is for text/plain responses', async () => {
    const { web_fetch_page } = await loadHandlers();
    const plainText = 'Just plain text content here.\nSecond line.';
    const encoder = new TextEncoder();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/notes.txt',
      headers: { get: () => 'text/plain; charset=utf-8' },
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: encoder.encode(plainText) })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });

    const result = String(await web_fetch_page({ url: 'https://example.com/notes.txt' }));
    expect(result).toContain('Just plain text content here.');
    expect(result).toContain('Second line.');
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  it('blocks non-text content types', async () => {
    const { web_fetch_page } = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/file.pdf',
      headers: { get: () => 'application/pdf' },
      body: null,
    });
    await expect(web_fetch_page({ url: 'https://example.com/file.pdf' })).rejects.toThrow('Cannot read non-text content-type');
  });

  it('propagates HTTP error status', async () => {
    const { web_fetch_page } = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      url: 'https://example.com/missing',
    });
    await expect(web_fetch_page({ url: 'https://example.com/missing' })).rejects.toThrow('HTTP 404 Not Found');
  });

  it('includes redirect note when final URL differs from requested URL', async () => {
    const { web_fetch_page } = await loadHandlers();
    const encoder = new TextEncoder();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/final-destination',  // different from requested
      headers: { get: () => 'text/plain' },
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: encoder.encode('content') })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });

    const result = String(await web_fetch_page({ url: 'https://example.com/redirect' }));
    expect(result).toContain('Final URL:');
    expect(result).toContain('https://example.com/final-destination');
  });
});
