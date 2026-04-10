// Deep Research skill handler — multi-angle web research via Brave Search API.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md §4.1, §5.1, §6
// Issue: #238
//
// This handler fans out a research question across several search-query angles,
// deduplicates the results by URL, and returns a structured source collection.
// The session orchestrator's LLM then synthesizes a research report from the
// collected material.
//
// The long-running / Virtual Employee delegation aspects of #238 remain blocked
// on #498 (Limbic System + MindSessionGuard + Chrono-Backplane). This
// implementation ships the synchronous multi-angle slice that can run now.

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
  web: z.object({
    results: z.array(BraveWebResultSchema),
  }).optional(),
});

// ---------------------------------------------------------------------------
// DuckDuckGo Instant Answer — zero-key fallback (mirrors skills/web/handlers.ts)
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

async function ddgFlatSearch(query: string, count: number): Promise<WebResult[]> {
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
    return []; // silent fallback — research angle just returns no results
  }

  const data: unknown = await response.json();
  const parsed = DdgResponseSchema.parse(data);
  const results: WebResult[] = [];

  if (parsed.Abstract && parsed.AbstractURL) {
    const source = parsed.AbstractSource ? ` (${parsed.AbstractSource})` : '';
    results.push({
      title: `${parsed.Heading ?? query}${source}`,
      url: parsed.AbstractURL,
      description: parsed.Abstract.substring(0, 300),
    });
  }

  for (const topic of parsed.RelatedTopics ?? []) {
    if (results.length >= count) break;
    if ('Name' in topic) continue;
    if (!topic.FirstURL || !topic.Text) continue;
    const titleEnd = topic.Text.indexOf(' - ');
    const title = titleEnd > 0 ? topic.Text.substring(0, titleEnd).trim() : topic.Text.substring(0, 60);
    results.push({ title, url: topic.FirstURL, description: topic.Text.substring(0, 200) });
  }

  return results.slice(0, count);
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const DeepResearchInputSchema = z.object({
  question: z.string().min(1),
  sourcesPerAngle: z.number().min(1).max(8).optional(),
  angles: z.array(z.string().min(1)).min(1).max(5).optional(),
});

// ---------------------------------------------------------------------------
// Brave Search API helper (mirrors skills/web/handlers.ts)
// ---------------------------------------------------------------------------

interface SearchOptions {
  query: string;
  count: number;
}

interface WebResult {
  title: string;
  url: string;
  description?: string;
  age?: string;
}

async function braveSearch(opts: SearchOptions): Promise<WebResult[]> {
  const apiKey = process.env['BRAVE_SEARCH_API_KEY'];
  if (!apiKey || apiKey === 'not-configured') {
    // Brave Search key not configured — use DuckDuckGo Instant Answer as fallback.
    // Results are more limited but the tool remains functional without any API key.
    return ddgFlatSearch(opts.query, opts.count);
  }

  const params = new URLSearchParams({
    q: opts.query,
    count: String(Math.min(Math.max(opts.count, 1), 20)),
    country: 'us',
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
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Brave Search API error: ${response.status} ${response.statusText} — ${errorText}`);
  }

  const data: unknown = await response.json();
  const parsed = BraveSearchResponseSchema.parse(data);
  return parsed.web?.results ?? [];
}

// ---------------------------------------------------------------------------
// Query angle derivation
//
// Produces 3 search angles from the original question without an LLM call.
// The angles cover: the exact question, a broader context angle, and a
// recent-development angle.
// ---------------------------------------------------------------------------

export function deriveResearchAngles(question: string): [string, string, string] {
  const clean = question.trim();

  // Extract the first significant noun phrase (heuristic: words before any verb)
  const topicMatch = clean.match(/^(?:what is|how does|why is|tell me about|research|investigate|explain)\s+(.+?)(?:\s+in\s+|\s+for\s+|\s+with\s+|\?|$)/i);
  const coreTopic = topicMatch?.[1]?.trim() ?? clean;

  return [
    clean,
    `${coreTopic} overview background context`,
    `${coreTopic} 2025 2026 latest developments`,
  ];
}

// ---------------------------------------------------------------------------
// Format output
// ---------------------------------------------------------------------------

interface AngleResult {
  angle: string;
  results: WebResult[];
}

function formatResearchOutput(question: string, angleResults: AngleResult[]): string {
  const seenUrls = new Set<string>();
  const sections: string[] = [];

  sections.push(`## Research: "${question}"\n`);

  let totalSources = 0;

  for (const { angle, results } of angleResults) {
    const uniqueResults = results.filter((r) => {
      if (seenUrls.has(r.url)) return false;
      seenUrls.add(r.url);
      return true;
    });

    if (uniqueResults.length === 0) continue;

    sections.push(`### Angle: ${angle}\n`);

    for (const result of uniqueResults) {
      const desc = result.description ? `\n  ${result.description}` : '';
      const age = result.age ? ` _(${result.age})_` : '';
      sections.push(`- **[${result.title}](${result.url})**${age}${desc}`);
      totalSources++;
    }

    sections.push('');
  }

  sections.push(`---\n_${totalSources} unique sources collected across ${angleResults.length} search angle(s)._`);

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Handler export
// ---------------------------------------------------------------------------

export const deep_research: ToolHandler = async (args) => {
  const input = DeepResearchInputSchema.parse(args);
  const sourcesPerAngle = input.sourcesPerAngle ?? 5;

  const queryAngles: string[] = input.angles ?? [...deriveResearchAngles(input.question)];

  // Fan out all searches in parallel
  const searchResults = await Promise.allSettled(
    queryAngles.map((angle) => braveSearch({ query: angle, count: sourcesPerAngle })),
  );

  const angleResults: AngleResult[] = queryAngles.map((angle, i) => {
    const result = searchResults[i];
    return {
      angle,
      results: result?.status === 'fulfilled' ? result.value : [],
    };
  });

  return formatResearchOutput(input.question, angleResults);
};
