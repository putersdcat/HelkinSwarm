// Web search skill handler — Bing Web Search API v7.
// Spec ref: 05-Capabilities-Framework.md
// Issue: #190
//
// API: https://api.bing.microsoft.com/v7.0/search
// Key source: BING_SEARCH_API_KEY env var (stored in Key Vault)

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas for Bing API response validation at boundary
// ---------------------------------------------------------------------------

const BingWebPageSchema = z.object({
  name: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  dateLastCrawled: z.string().optional(),
});

const BingSearchResponseSchema = z.object({
  webPages: z.object({
    totalEstimatedMatches: z.number().optional(),
    value: z.array(BingWebPageSchema),
  }).optional(),
  queryContext: z.object({
    originalQuery: z.string(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// Search implementation
// ---------------------------------------------------------------------------

interface SearchOptions {
  query: string;
  count: number;
  market: string;
}

async function bingSearch(opts: SearchOptions): Promise<z.infer<typeof BingSearchResponseSchema>> {
  const apiKey = process.env['BING_SEARCH_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'Web search not configured — BING_SEARCH_API_KEY not set. ' +
      'Provision a Bing Search resource in Azure and add the key to Key Vault.',
    );
  }

  const params = new URLSearchParams({
    q: opts.query,
    count: String(Math.min(Math.max(opts.count, 1), 10)),
    mkt: opts.market,
    responseFilter: 'Webpages',
    textFormat: 'Raw',
  });

  const response = await fetch(
    `https://api.bing.microsoft.com/v7.0/search?${params}`,
    {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Bing Search API error: ${response.status} ${response.statusText} — ${errorText}`);
  }

  const data: unknown = await response.json();
  return BingSearchResponseSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Format output
// ---------------------------------------------------------------------------

function formatResults(results: z.infer<typeof BingSearchResponseSchema>, query: string): string {
  if (!results.webPages || results.webPages.value.length === 0) {
    return `No web results found for "${query}".`;
  }

  const header = `🔍 **Web search: "${query}"**\n`;
  const total = results.webPages.totalEstimatedMatches
    ? `*~${results.webPages.totalEstimatedMatches.toLocaleString()} results*\n`
    : '';

  const items = results.webPages.value.map((page, i) => {
    const snippet = page.snippet ? `\n   ${page.snippet}` : '';
    return `${i + 1}. **[${page.name}](${page.url})**${snippet}`;
  }).join('\n\n');

  return `${header}${total}\n${items}`;
}

// ---------------------------------------------------------------------------
// Tool: web_search
// ---------------------------------------------------------------------------

export const web_search: ToolHandler = async (args) => {
  const query = String(args['query'] ?? '').trim();
  if (!query) throw new Error('Search query is required');

  const count = Math.min(Math.max(Number(args['count'] ?? 5), 1), 10);
  const market = String(args['market'] ?? 'en-US');

  const results = await bingSearch({ query, count, market });
  return formatResults(results, query);
};
