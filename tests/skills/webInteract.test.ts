// Tests for web_interact tool handler — Playwright-based interactive browser.
// Issue: #177 Phase 2 (Full Interactive Playwright)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock objects — accessible in both vi.mock factory and test bodies
// ---------------------------------------------------------------------------

const { mockPage, mockBrowser } = vi.hoisted(() => {
  const mockPage = {
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    content: vi.fn().mockResolvedValue(
      '<html><body><h1>Test Page</h1><p>Hello world</p></body></html>',
    ),
    url: vi.fn().mockReturnValue('https://example.com'),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { mockPage, mockBrowser };
});

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

import { web_interact } from '../../skills/web/handlers.js';

describe('web_interact', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset to happy-path defaults before each test
    mockPage.goto.mockResolvedValue({ ok: () => true, status: () => 200 });
    mockPage.content.mockResolvedValue(
      '<html><body><h1>Test Page</h1><p>Hello world</p></body></html>',
    );
    mockPage.url.mockReturnValue('https://example.com');
    mockPage.waitForSelector.mockResolvedValue(undefined);
    mockPage.waitForLoadState.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // SSRF guard — must use same logic as web_fetch_page
  // -------------------------------------------------------------------------

  describe('SSRF guard', () => {
    it('blocks localhost without calling playwright', async () => {
      await expect(web_interact({ url: 'http://localhost/page' })).rejects.toThrow(
        'URL not allowed: localhost',
      );
      expect(mockBrowser.newPage).not.toHaveBeenCalled();
    });

    it('blocks 127.0.0.1 loopback range', async () => {
      await expect(web_interact({ url: 'http://127.0.0.1/secret' })).rejects.toThrow(
        'URL not allowed',
      );
    });

    it('blocks Azure IMDS (169.254.x.x) without calling playwright', async () => {
      await expect(
        web_interact({ url: 'http://169.254.169.254/metadata/instance' }),
      ).rejects.toThrow('cloud metadata endpoint');
      expect(mockBrowser.newPage).not.toHaveBeenCalled();
    });

    it('blocks private IPv4 ranges (10.x, 192.168.x, 172.16-31.x)', async () => {
      await expect(web_interact({ url: 'http://10.0.0.1/admin' })).rejects.toThrow(
        'private/reserved IP range',
      );
      await expect(web_interact({ url: 'http://192.168.1.100/' })).rejects.toThrow(
        'private/reserved IP range',
      );
      await expect(web_interact({ url: 'http://172.20.0.5/' })).rejects.toThrow(
        'private/reserved IP range',
      );
    });

    it('blocks non-HTTP schemes without calling playwright', async () => {
      await expect(web_interact({ url: 'file:///etc/passwd' })).rejects.toThrow('non-HTTP scheme');
      await expect(web_interact({ url: 'ftp://example.com/data' })).rejects.toThrow(
        'non-HTTP scheme',
      );
      expect(mockBrowser.newPage).not.toHaveBeenCalled();
    });

    it('rejects missing url argument', async () => {
      await expect(web_interact({})).rejects.toThrow('url is required');
    });
  });

  // -------------------------------------------------------------------------
  // Basic navigation
  // -------------------------------------------------------------------------

  describe('basic navigation', () => {
    it('navigates to URL and returns extracted page text', async () => {
      const result = await web_interact({ url: 'https://example.com' });
      expect(result).toContain('https://example.com');
      expect(result).toContain('Test Page');
      expect(result).toContain('Hello world');
    });

    it('launches browser with --no-sandbox flags', async () => {
      const { chromium } = await import('playwright');
      await web_interact({ url: 'https://example.com' });
      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          args: expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox']),
        }),
      );
    });

    it('closes browser in finally block even on error', async () => {
      mockPage.goto.mockRejectedValueOnce(new Error('Navigation timeout'));
      await expect(web_interact({ url: 'https://example.com' })).rejects.toThrow(
        'Navigation timeout',
      );
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('includes redirect note when final URL differs from requested URL', async () => {
      mockPage.url.mockReturnValue('https://www.example.com/redirected');
      const result = await web_interact({ url: 'https://example.com' });
      expect(result).toContain('**Final URL:** https://www.example.com/redirected');
    });

    it('does not include redirect note when URL is unchanged', async () => {
      const result = await web_interact({ url: 'https://example.com' });
      expect(result).not.toContain('Final URL');
    });

    it('throws on non-successful HTTP response', async () => {
      mockPage.goto.mockResolvedValue({ ok: () => false, status: () => 404 });
      await expect(web_interact({ url: 'https://example.com/missing' })).rejects.toThrow(
        'HTTP 404',
      );
    });
  });

  // -------------------------------------------------------------------------
  // wait_for argument
  // -------------------------------------------------------------------------

  describe('wait_for', () => {
    it('waits for a CSS selector before running actions', async () => {
      await web_interact({ url: 'https://example.com', wait_for: '.main-content' });
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('.main-content', expect.any(Object));
    });

    it('waits for networkidle state when wait_for is "networkidle"', async () => {
      await web_interact({ url: 'https://example.com', wait_for: 'networkidle' });
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle', expect.any(Object));
    });
  });

  // -------------------------------------------------------------------------
  // Action sequence
  // -------------------------------------------------------------------------

  describe('actions', () => {
    it('performs click action with selector', async () => {
      await web_interact({
        url: 'https://example.com',
        actions: [{ type: 'click', selector: '#submit-btn' }],
      });
      expect(mockPage.click).toHaveBeenCalledWith('#submit-btn', expect.any(Object));
    });

    it('performs fill action with value', async () => {
      await web_interact({
        url: 'https://example.com',
        actions: [{ type: 'fill', selector: 'input[name=email]', value: 'user@example.com' }],
      });
      expect(mockPage.fill).toHaveBeenCalledWith(
        'input[name=email]',
        'user@example.com',
        expect.any(Object),
      );
    });

    it('performs select action with option', async () => {
      await web_interact({
        url: 'https://example.com',
        actions: [{ type: 'select', selector: '#country', option: 'US' }],
      });
      expect(mockPage.selectOption).toHaveBeenCalledWith('#country', 'US', expect.any(Object));
    });

    it('performs wait_for action as waitForSelector', async () => {
      await web_interact({
        url: 'https://example.com',
        actions: [{ type: 'wait_for', selector: '.result-list' }],
      });
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        '.result-list',
        expect.any(Object),
      );
    });

    it('performs press action with key name', async () => {
      await web_interact({
        url: 'https://example.com',
        actions: [{ type: 'press', key: 'Enter' }],
      });
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
    });

    it('includes actions performed count in output when actions are present', async () => {
      const result = await web_interact({
        url: 'https://example.com',
        actions: [
          { type: 'fill', selector: '#q', value: 'hello' },
          { type: 'press', key: 'Enter' },
        ],
      });
      expect(result).toContain('**Actions performed:** 2');
    });

    it('executes multi-step login sequence in order', async () => {
      const callOrder: string[] = [];
      mockPage.fill.mockImplementation(async (sel: string) => { callOrder.push(`fill:${sel}`); });
      mockPage.click.mockImplementation(async (sel: string) => { callOrder.push(`click:${sel}`); });

      await web_interact({
        url: 'https://example.com/login',
        actions: [
          { type: 'fill', selector: '#email', value: 'a@b.com' },
          { type: 'fill', selector: '#password', value: 'secret' },
          { type: 'click', selector: 'button[type=submit]' },
        ],
      });

      expect(callOrder).toEqual(['fill:#email', 'fill:#password', 'click:button[type=submit]']);
    });

    it('rejects invalid action type via Zod parse', async () => {
      await expect(
        web_interact({
          url: 'https://example.com',
          actions: [{ type: 'unknown_action', selector: '.x' }],
        }),
      ).rejects.toThrow();
    });
  });
});
