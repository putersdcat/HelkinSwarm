// Web search skill handler — Brave Web Search API.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #190
//
// API: https://api.search.brave.com/res/v1/web/search
// Key source: BRAVE_SEARCH_API_KEY env var (stored in Key Vault)
// Note: Bing Search APIs retired Aug 2025 — migrated to Brave Search.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas for Brave Search API response validation at boundary
// ---------------------------------------------------------------------------

const BraveWebResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  age: z.string().optional(),
});

const BraveSearchResponseSchema = z.object({
  query: z.object({
    original: z.string(),
  }).optional(),
  web: z.object({
    results: z.array(BraveWebResultSchema),
  }).optional(),
});

// ---------------------------------------------------------------------------
// DuckDuckGo Instant Answer API — zero-key fallback when Brave is not configured
// API: https://api.duckduckgo.com/?q={query}&format=json
// Returns: topic summaries and related links from DuckDuckGo's index.
// Quality: lower than Brave for open-ended news queries; fine for factual lookups.
// ---------------------------------------------------------------------------

const DdgTopicItemSchema = z.object({
  Text: z.string().optional(),
  FirstURL: z.string().optional(),
});

const DdgResponseSchema = z.object({
  Abstract: z.string().optional(),
  AbstractSource: z.string().optional(),
  AbstractURL: z.string().optional(),
  Heading: z.string().optional(),
  RelatedTopics: z.array(
    z.union([
      DdgTopicItemSchema,
      z.object({ Name: z.string(), Topics: z.array(DdgTopicItemSchema).optional() }),
    ]),
  ).optional(),
});

async function ddgSearch(query: string, count: number): Promise<z.infer<typeof BraveSearchResponseSchema>> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });

  const response = await fetch(
    `https://api.duckduckgo.com/?${params}`,
    {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'HelkinSwarm/1.0' },
      signal: AbortSignal.timeout(8_000),
    },
  );

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: ${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  const parsed = DdgResponseSchema.parse(data);

  const results: z.infer<typeof BraveWebResultSchema>[] = [];

  // Lead result: Wikipedia abstract or similar featured article
  if (parsed.Abstract && parsed.AbstractURL) {
    const source = parsed.AbstractSource ? ` (${parsed.AbstractSource})` : '';
    results.push({
      title: `${parsed.Heading ?? query}${source}`,
      url: parsed.AbstractURL,
      description: parsed.Abstract.substring(0, 300),
    });
  }

  // Related topics — skip category groupings (no FirstURL at top level)
  for (const topic of parsed.RelatedTopics ?? []) {
    if (results.length >= count) break;
    if ('Name' in topic) continue; // skip category containers
    if (!topic.FirstURL || !topic.Text) continue;
    const titleEnd = topic.Text.indexOf(' - ');
    const title = titleEnd > 0 ? topic.Text.substring(0, titleEnd).trim() : topic.Text.substring(0, 60);
    results.push({
      title,
      url: topic.FirstURL,
      description: topic.Text.substring(0, 200),
    });
  }

  return { web: { results: results.slice(0, count) } };
}

// ---------------------------------------------------------------------------
// Search implementation
// ---------------------------------------------------------------------------

interface SearchOptions {
  query: string;
  count: number;
  country: string;
}

async function braveSearch(opts: SearchOptions): Promise<z.infer<typeof BraveSearchResponseSchema>> {
  const apiKey = process.env['BRAVE_SEARCH_API_KEY'];
  if (!apiKey || apiKey === 'not-configured') {
    // Brave Search key not configured — use DuckDuckGo Instant Answer (no key required).
    // Results are limited compared to Brave but functional for factual and topic lookups.
    return ddgSearch(opts.query, opts.count);
  }

  const params = new URLSearchParams({
    q: opts.query,
    count: String(Math.min(Math.max(opts.count, 1), 20)),
    country: opts.country,
    text_decorations: 'false',
    search_lang: 'en',
  });

  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText} — ${errorText}`);
  }

  const data: unknown = await response.json();
  return BraveSearchResponseSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Format output
// ---------------------------------------------------------------------------

function formatResults(results: z.infer<typeof BraveSearchResponseSchema>, query: string, degraded = false): string {
  if (!results.web || results.web.results.length === 0) {
    return `No web results found for "${query}".`;
  }

  const noteStr = degraded ? '\n> ⚠️ _Using DuckDuckGo Instant Answer (limited coverage). For full web search, configure Brave Search API key in Key Vault._\n' : '';
  const header = `🔍 **Web search: "${query}"**${noteStr}\n`;

  const items = results.web.results.map((page, i) => {
    const desc = page.description ? `\n   ${page.description}` : '';
    const age = page.age ? ` _(${page.age})_` : '';
    return `${i + 1}. **[${page.title}](${page.url})**${age}${desc}`;
  }).join('\n\n');

  return `${header}\n${items}`;
}

// ---------------------------------------------------------------------------
// Tool: web_search
// ---------------------------------------------------------------------------

export const web_search: ToolHandler = async (args) => {
  const query = String(args['query'] ?? '').trim();
  if (!query) throw new Error('Search query is required');

  const count = Math.min(Math.max(Number(args['count'] ?? 5), 1), 10);
  const country = String(args['market'] ?? 'us');

  const apiKey = process.env['BRAVE_SEARCH_API_KEY'];
  const usingDdg = !apiKey || apiKey === 'not-configured';
  const results = await braveSearch({ query, count, country });
  return formatResults(results, query, usingDdg);
};

// ---------------------------------------------------------------------------
// SSRF guard — block private/link-local/metadata IP ranges and non-HTTP schemes.
// Defense against requests targeting internal Azure services or cloud metadata.
// ---------------------------------------------------------------------------

function checkSsrf(rawUrl: string): { blocked: true; reason: string } | { blocked: false } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { blocked: true, reason: 'invalid URL' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { blocked: true, reason: `non-HTTP scheme "${protocol}"` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Localhost variants
  if (hostname === 'localhost' || hostname === '::1') {
    return { blocked: true, reason: 'localhost' };
  }

  // Azure IMDS / cloud metadata endpoints (link-local 169.254.x.x)
  if (/^169\.254\./.test(hostname)) {
    return { blocked: true, reason: 'cloud metadata endpoint' };
  }

  // IPv4 private / reserved ranges
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (ipv4) {
    const a = parseInt(ipv4[1] ?? '0', 10);
    const b = parseInt(ipv4[2] ?? '0', 10);
    if (
      a === 10 ||                              // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) ||    // 172.16.0.0/12
      (a === 192 && b === 168) ||             // 192.168.0.0/16
      (a === 100 && b >= 64 && b <= 127) ||   // 100.64.0.0/10 CGNAT
      a === 127 ||                            // 127.0.0.0/8
      a === 0 ||                              // 0.0.0.0/8
      a >= 240                               // 240.0.0.0/4 reserved
    ) {
      return { blocked: true, reason: 'private/reserved IP range' };
    }
  }

  return { blocked: false };
}

// ---------------------------------------------------------------------------
// HTML → plain text extraction (no external dependencies)
// Strips scripts, styles, tags and decodes common entities.
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|tr|table|blockquote|pre|article|section|aside|header|footer|nav|main|figure|figcaption)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const n = parseInt(code, 10);
      return isNaN(n) ? _match : String.fromCharCode(n);
    })
    .replace(/\t/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

// ---------------------------------------------------------------------------
// Tool: web_fetch_page
// ---------------------------------------------------------------------------

const MAX_FETCH_BYTES = 500_000; // 500 KB network cap
const MAX_OUTPUT_CHARS = 8_000;  // LLM context budget

export const web_fetch_page: ToolHandler = async (args) => {
  const rawUrl = String(args['url'] ?? '').trim();
  if (!rawUrl) throw new Error('url is required');

  const ssrf = checkSsrf(rawUrl);
  if (ssrf.blocked) {
    throw new Error(`URL not allowed: ${ssrf.reason}`);
  }

  const response = await fetch(rawUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,text/plain,*/*;q=0.8',
      'User-Agent': 'HelkinSwarm/1.0 (+https://github.com/putersdcat/HelkinSwarm; web reader)',
    },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} fetching "${rawUrl}"`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isHtml = /text\/html|application\/xhtml/i.test(contentType);
  const isText = /text\//i.test(contentType);

  if (!isHtml && !isText) {
    throw new Error(`Cannot read non-text content-type "${contentType}" at "${rawUrl}"`);
  }

  // Streamed read with byte cap to prevent oversized responses from bloating memory
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response body');

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const remaining = MAX_FETCH_BYTES - totalBytes;
      if (value.length >= remaining) {
        chunks.push(value.slice(0, remaining));
        truncated = true;
        break;
      }
      chunks.push(value);
      totalBytes += value.length;
    }
  }

  reader.cancel().catch(() => undefined);

  const combined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const rawBody = new TextDecoder().decode(combined);
  const text = isHtml ? htmlToText(rawBody) : rawBody.trim();

  const truncNote = truncated ? '\n\n_(Content truncated at 500 KB)_' : '';
  const redirectNote = response.url !== rawUrl ? `\n**Final URL:** ${response.url}` : '';

  return `**Fetched:** ${rawUrl}${redirectNote}\n**Content-Type:** ${contentType}\n\n---\n\n${text.slice(0, MAX_OUTPUT_CHARS)}${truncNote}`;
};
