// Tests for web_extract tool handler — structured markdown extraction, SSRF guard, instruction passthrough.
// Issue: #631 (Phase S2 — tool surface expansion)

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

async function loadHandlers() {
  vi.resetModules();
  return await import('../../skills/web/handlers.js');
}

function makeFetchResponse(body: string, opts?: { url?: string; contentType?: string }) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: opts?.url ?? 'https://example.com/page',
    headers: { get: () => opts?.contentType ?? 'text/html; charset=utf-8' },
    body: {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: encoder.encode(body) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    },
  };
}

describe('web_extract', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // SSRF guard (shared with web_fetch_page)
  // -------------------------------------------------------------------------

  it('blocks localhost and private IPs', async () => {
    const { web_extract } = await loadHandlers();
    await expect(web_extract({ url: 'http://localhost/secret' })).rejects.toThrow('URL not allowed');
    await expect(web_extract({ url: 'http://169.254.169.254/metadata' })).rejects.toThrow('URL not allowed');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects missing url argument', async () => {
    const { web_extract } = await loadHandlers();
    await expect(web_extract({})).rejects.toThrow('url is required');
  });

  // -------------------------------------------------------------------------
  // Structured extraction — headings
  // -------------------------------------------------------------------------

  it('converts HTML headings to markdown headings', async () => {
    const { web_extract } = await loadHandlers();
    const html = '<html><body><h1>Title</h1><h2>Section</h2><h3>Subsection</h3><p>Body text.</p></body></html>';
    mockFetch.mockResolvedValue(makeFetchResponse(html));

    const result = String(await web_extract({ url: 'https://example.com/page' }));
    expect(result).toContain('# Title');
    expect(result).toContain('## Section');
    expect(result).toContain('### Subsection');
    expect(result).toContain('Body text.');
  });

  // -------------------------------------------------------------------------
  // Structured extraction — tables
  // -------------------------------------------------------------------------

  it('converts HTML tables to markdown tables', async () => {
    const { web_extract } = await loadHandlers();
    const html = [
      '<table>',
      '<tr><th>Name</th><th>Price</th></tr>',
      '<tr><td>Widget A</td><td>$10</td></tr>',
      '<tr><td>Widget B</td><td>$20</td></tr>',
      '</table>',
    ].join('');
    mockFetch.mockResolvedValue(makeFetchResponse(html));

    const result = String(await web_extract({ url: 'https://example.com/products' }));
    expect(result).toContain('| Name | Price |');
    expect(result).toContain('| --- | --- |');
    expect(result).toContain('| Widget A | $10 |');
    expect(result).toContain('| Widget B | $20 |');
  });

  // -------------------------------------------------------------------------
  // Structured extraction — links
  // -------------------------------------------------------------------------

  it('converts HTML links to markdown links', async () => {
    const { web_extract } = await loadHandlers();
    const html = '<p>Visit <a href="https://example.com/docs">the docs</a> for more.</p>';
    mockFetch.mockResolvedValue(makeFetchResponse(html));

    const result = String(await web_extract({ url: 'https://example.com/page' }));
    expect(result).toContain('[the docs](https://example.com/docs)');
  });

  // -------------------------------------------------------------------------
  // Structured extraction — lists
  // -------------------------------------------------------------------------

  it('converts HTML lists to markdown lists', async () => {
    const { web_extract } = await loadHandlers();
    const html = '<ul><li>First item</li><li>Second item</li><li>Third item</li></ul>';
    mockFetch.mockResolvedValue(makeFetchResponse(html));

    const result = String(await web_extract({ url: 'https://example.com/page' }));
    expect(result).toContain('- First item');
    expect(result).toContain('- Second item');
    expect(result).toContain('- Third item');
  });

  // -------------------------------------------------------------------------
  // Scripts and styles stripped
  // -------------------------------------------------------------------------

  it('strips scripts and styles before extraction', async () => {
    const { web_extract } = await loadHandlers();
    const html = [
      '<html><head>',
      '<style>.secret { display: none; }</style>',
      '<script>alert("xss")</script>',
      '</head><body><h1>Clean Content</h1></body></html>',
    ].join('');
    mockFetch.mockResolvedValue(makeFetchResponse(html));

    const result = String(await web_extract({ url: 'https://example.com/page' }));
    expect(result).toContain('# Clean Content');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('.secret');
  });

  // -------------------------------------------------------------------------
  // Instructions passthrough
  // -------------------------------------------------------------------------

  it('includes extraction instructions in output header', async () => {
    const { web_extract } = await loadHandlers();
    const html = '<html><body><h1>Products</h1><p>Some content.</p></body></html>';
    mockFetch.mockResolvedValue(makeFetchResponse(html));

    const result = String(await web_extract({
      url: 'https://example.com/products',
      instructions: 'extract all product names and prices',
    }));
    expect(result).toContain('**Extraction instructions:** extract all product names and prices');
    expect(result).toContain('# Products');
  });

  it('omits instructions header when no instructions provided', async () => {
    const { web_extract } = await loadHandlers();
    const html = '<html><body><p>Simple page.</p></body></html>';
    mockFetch.mockResolvedValue(makeFetchResponse(html));

    const result = String(await web_extract({ url: 'https://example.com/simple' }));
    expect(result).not.toContain('Extraction instructions');
  });

  // -------------------------------------------------------------------------
  // Entity decoding
  // -------------------------------------------------------------------------

  it('decodes HTML entities correctly', async () => {
    const { web_extract } = await loadHandlers();
    const html = '<p>Prices: $10 &amp; up &mdash; &quot;best deal&quot; &lt;top&gt;</p>';
    mockFetch.mockResolvedValue(makeFetchResponse(html));

    const result = String(await web_extract({ url: 'https://example.com/page' }));
    expect(result).toContain('$10 & up');
    expect(result).toContain('"best deal"');
    expect(result).toContain('<top>');
  });

  // -------------------------------------------------------------------------
  // Redirect note
  // -------------------------------------------------------------------------

  it('shows redirect note when final URL differs', async () => {
    const { web_extract } = await loadHandlers();
    mockFetch.mockResolvedValue(makeFetchResponse(
      '<p>Redirected content.</p>',
      { url: 'https://example.com/final' },
    ));

    const result = String(await web_extract({ url: 'https://example.com/redirect' }));
    expect(result).toContain('**Final URL:** https://example.com/final');
  });

  // -------------------------------------------------------------------------
  // 16 KB output budget
  // -------------------------------------------------------------------------

  it('returns up to 16 KB of structured content', async () => {
    const { web_extract } = await loadHandlers();
    // Generate HTML with lots of content
    const paragraphs = Array.from({ length: 200 }, (_, i) => `<p>Paragraph ${i}: ${'x'.repeat(100)}</p>`).join('');
    const html = `<html><body>${paragraphs}</body></html>`;
    mockFetch.mockResolvedValue(makeFetchResponse(html));

    const result = String(await web_extract({ url: 'https://example.com/long' }));
    // Should contain more than 8KB (web_fetch_page limit) but be bounded at ~16KB
    const contentAfterHeader = result.split('---\n\n')[1] ?? '';
    expect(contentAfterHeader.length).toBeGreaterThan(8_000);
    expect(contentAfterHeader.length).toBeLessThanOrEqual(16_001);
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  it('blocks non-text content types', async () => {
    const { web_extract } = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/file.pdf',
      headers: { get: () => 'application/pdf' },
      body: null,
    });
    await expect(web_extract({ url: 'https://example.com/file.pdf' })).rejects.toThrow('Cannot read non-text content-type');
  });

  it('propagates HTTP error status', async () => {
    const { web_extract } = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      url: 'https://example.com/error',
    });
    await expect(web_extract({ url: 'https://example.com/error' })).rejects.toThrow('HTTP 500');
  });
});
