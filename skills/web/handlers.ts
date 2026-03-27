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
    throw new Error(
      'Web search not configured — BRAVE_SEARCH_API_KEY not set. ' +
      'Sign up at https://api.search.brave.com/ and store the key in Key Vault.',
    );
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

function formatResults(results: z.infer<typeof BraveSearchResponseSchema>, query: string): string {
  if (!results.web || results.web.results.length === 0) {
    return `No web results found for "${query}".`;
  }

  const header = `🔍 **Web search: "${query}"**\n`;

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

  const results = await braveSearch({ query, count, country });
  return formatResults(results, query);
};
