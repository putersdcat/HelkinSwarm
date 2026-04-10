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
