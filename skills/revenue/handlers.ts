// Revenue Discovery skill handlers — opportunity scanning for the virtual company.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md §6
// Issue: #249
//
// Uses DuckDuckGo Instant Answer API to scan for freelance and consulting
// opportunities matching the agent's current skill set. Returns structured
// recommendations with value/effort/risk/skill-fit scoring.
//
// Living Mind compliance: runs in-session, single autobiographical stream,
// no parallel identity forking. VE delegation aspects remain scoped to
// single-session contract per #494/#498.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Brave Search schemas — mirrors skills/research/handlers.ts boundary pattern
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
// DuckDuckGo schemas — fallback when Brave key is absent
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

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type RatingLevel = 'low' | 'medium' | 'high';

export interface OpportunityScore {
  value_potential: RatingLevel;
  effort_level: RatingLevel;
  risk_level: RatingLevel;
  skill_fit: RatingLevel;
}

interface OpportunityResult {
  title: string;
  url: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Search helpers — Brave Search primary, DDG Instant Answer fallback
// ---------------------------------------------------------------------------

async function braveOpportunitySearch(
  query: string,
  count: number,
): Promise<OpportunityResult[]> {
  const apiKey = process.env['BRAVE_SEARCH_API_KEY'];
  if (!apiKey || apiKey === 'not-configured') {
    return ddgInstantSearch(query, count);
  }

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(Math.max(count, 1), 20)),
    country: 'us',
    text_decorations: 'false',
    search_lang: 'en',
  });

  try {
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
      return ddgInstantSearch(query, count); // fallback on Brave error
    }

    const data: unknown = await response.json();
    const parsed = BraveSearchResponseSchema.parse(data);
    return (parsed.web?.results ?? []).slice(0, count).map(r => ({
      title: r.title,
      url: r.url,
      description: (r.description ?? '').substring(0, 300),
    }));
  } catch {
    return ddgInstantSearch(query, count); // fallback on exception
  }
}

async function ddgInstantSearch(
  query: string,
  count: number,
): Promise<OpportunityResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
  });

  try {
    const response = await fetch(
      `https://api.duckduckgo.com/?${params}`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'User-Agent': 'HelkinSwarm/1.0' },
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (!response.ok) {
      return [];
    }

    const data: unknown = await response.json();
    const parsed = DdgResponseSchema.parse(data);
    const results: OpportunityResult[] = [];

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
      const title =
        titleEnd > 0
          ? topic.Text.substring(0, titleEnd).trim()
          : topic.Text.substring(0, 60);
      results.push({
        title,
        url: topic.FirstURL,
        description: topic.Text.substring(0, 200),
      });
    }

    return results.slice(0, count);
  } catch {
    return [];
  }
}

// Exported for testing — delegates to Brave/DDG chain
export async function ddgOpportunitySearch(
  query: string,
  count: number,
): Promise<OpportunityResult[]> {
  return braveOpportunitySearch(query, count);
}

// ---------------------------------------------------------------------------
// Scoring helpers — keyword-based heuristic model
// ---------------------------------------------------------------------------

const HIGH_VALUE_TERMS = ['senior', 'lead', 'enterprise', 'long-term', 'retainer', 'hourly rate', 'per hour', 'contract rate', 'paid'];
const LOW_VALUE_TERMS = ['volunteer', 'unpaid', 'free work', 'internship', 'equity only', 'pro bono'];

const HIGH_EFFORT_TERMS = ['full-time', 'full time', '40 hours', 'ongoing', 'management', 'director', 'architect'];
const LOW_EFFORT_TERMS = ['quick task', 'one-time', 'simple task', 'microtask', 'small task', 'short project'];

const LOW_RISK_TERMS = ['upwork', 'fiverr', 'toptal', 'freelancer.com', 'established client', 'verified'];
const HIGH_RISK_TERMS = ['startup', 'equity', 'revenue share', 'unproven', 'new platform', 'undisclosed'];

const HIGH_FIT_TERMS = ['ai', 'machine learning', 'research', 'translation', 'writing', 'automation', 'data analysis', 'math', 'content creation', 'language model', 'nlp', 'chatbot'];
const LOW_FIT_TERMS = ['on-site', 'physical', 'driving', 'manual labor', 'hardware', 'welding', 'plumbing', 'construction'];

export function scoreOpportunity(title: string, description: string): OpportunityScore {
  const text = `${title} ${description}`.toLowerCase();

  const value_potential: RatingLevel =
    LOW_VALUE_TERMS.some(t => text.includes(t))
      ? 'low'
      : HIGH_VALUE_TERMS.some(t => text.includes(t))
        ? 'high'
        : 'medium';

  const effort_level: RatingLevel =
    LOW_EFFORT_TERMS.some(t => text.includes(t))
      ? 'low'
      : HIGH_EFFORT_TERMS.some(t => text.includes(t))
        ? 'high'
        : 'medium';

  const risk_level: RatingLevel =
    LOW_RISK_TERMS.some(t => text.includes(t))
      ? 'low'
      : HIGH_RISK_TERMS.some(t => text.includes(t))
        ? 'high'
        : 'medium';

  const skill_fit: RatingLevel =
    LOW_FIT_TERMS.some(t => text.includes(t))
      ? 'low'
      : HIGH_FIT_TERMS.some(t => text.includes(t))
        ? 'high'
        : 'medium';

  return { value_potential, effort_level, risk_level, skill_fit };
}

const RATING_WEIGHT = { high: 2, medium: 1, low: 0 } as const;

// Higher is better for value_potential, skill_fit, and (inverted) risk_level.
// Lower effort is better (more sustainable for an AI agent).
export function overallRecommendation(score: OpportunityScore): 'pursue' | 'evaluate' | 'skip' {
  const total =
    RATING_WEIGHT[score.value_potential] +  // high value = good
    RATING_WEIGHT[score.skill_fit] +          // high fit = good
    (2 - RATING_WEIGHT[score.risk_level]) +   // low risk = good (inverted)
    (2 - RATING_WEIGHT[score.effort_level]);  // low effort = good (inverted)
  // total range: 0–8
  return total >= 6 ? 'pursue' : total >= 4 ? 'evaluate' : 'skip';
}

// ---------------------------------------------------------------------------
// Tool: revenue_discover_opportunities
// ---------------------------------------------------------------------------

export const revenue_discover_opportunities: ToolHandler = async (args) => {
  const skillsetFocus =
    typeof args['skillset_focus'] === 'string' && args['skillset_focus'].trim()
      ? args['skillset_focus'].trim()
      : 'AI research automation translation writing';

  const maxResults = Math.min(Math.max(Number(args['max_results']) || 8, 1), 20);
  const perAngle = Math.ceil(maxResults / 3);

  const searchAngles = [
    `freelance ${skillsetFocus} remote work 2026`,
    `consulting ${skillsetFocus} gig contract remote`,
    `AI automation ${skillsetFocus} opportunity freelance`,
  ];

  // Fan out across all search angles concurrently
  const angleResults = await Promise.all(
    searchAngles.map(q => ddgOpportunitySearch(q, perAngle)),
  );

  // Flatten and deduplicate by URL
  const seen = new Set<string>();
  const deduped: OpportunityResult[] = [];
  for (const results of angleResults) {
    for (const r of results) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        deduped.push(r);
      }
    }
  }

  // Score each result, then sort by recommendation priority
  const ORDER: Record<string, number> = { pursue: 0, evaluate: 1, skip: 2 };
  const scored = deduped.slice(0, maxResults).map(r => {
    const score = scoreOpportunity(r.title, r.description);
    return { ...r, score, recommendation: overallRecommendation(score) };
  });
  scored.sort((a, b) => (ORDER[a.recommendation] ?? 3) - (ORDER[b.recommendation] ?? 3));

  return {
    count: scored.length,
    skillset_focus: skillsetFocus,
    opportunities: scored,
  };
};

// ---------------------------------------------------------------------------
// Tool: revenue_score_opportunity
// ---------------------------------------------------------------------------

export const revenue_score_opportunity: ToolHandler = async (args) => {
  const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
  const description = typeof args['description'] === 'string' ? args['description'].trim() : '';

  if (!title && !description) {
    throw new Error('At least one of title or description must be provided');
  }

  const score = scoreOpportunity(title, description);
  const recommendation = overallRecommendation(score);

  const positives: string[] = [];
  const negatives: string[] = [];

  if (score.value_potential === 'high') positives.push('high earning potential');
  else if (score.value_potential === 'low') negatives.push('low earning potential');

  if (score.skill_fit === 'high') positives.push('strong skill alignment');
  else if (score.skill_fit === 'low') negatives.push('poor skill alignment');

  if (score.risk_level === 'low') positives.push('low-risk platform/client');
  else if (score.risk_level === 'high') negatives.push('high-risk engagement');

  if (score.effort_level === 'low') positives.push('low time commitment');
  else if (score.effort_level === 'high') negatives.push('high time commitment');

  const parts: string[] = [];
  if (positives.length > 0) parts.push(positives.join(', '));
  if (negatives.length > 0) parts.push(`concerns: ${negatives.join(', ')}`);
  const explanation = parts.length > 0 ? parts.join('; ') : 'neutral opportunity — no strong signals either way';

  return {
    title: title || '(untitled)',
    score,
    recommendation,
    explanation,
  };
};
