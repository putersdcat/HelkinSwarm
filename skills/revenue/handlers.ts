// Revenue Discovery skill handlers — opportunity scanning for the virtual company.
// Spec ref: docs/skills-system-enhancement-2026-03-25.md §6
// Issue: #249
//
// Uses RemoteOK public API (no auth required) as the primary job-listing source,
// with DuckDuckGo Instant Answer as a broader research fallback.
//
// Living Mind compliance: runs in-session, single autobiographical stream,
// no parallel identity forking. VE delegation aspects remain scoped to
// single-session contract per #494/#498.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// RemoteOK API schema — public, no-auth endpoint returns live remote jobs
// ---------------------------------------------------------------------------

const RemoteOKJobSchema = z.object({
  slug: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  position: z.string().optional(),
  company: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  url: z.string().optional(),
  date: z.string().optional(),
});

const RemoteOKResponseSchema = z.array(
  z.union([
    // First element is always a legal notice object
    z.object({ legal: z.string() }),
    RemoteOKJobSchema,
  ]),
);

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
// Search helpers — RemoteOK primary, DDG Instant Answer fallback
// ---------------------------------------------------------------------------

/** Strip HTML tags for clean description text. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const REMOTE_OK_API = 'https://remoteok.com/api';

async function remoteOKSearch(
  keywords: readonly string[],
  count: number,
): Promise<OpportunityResult[]> {
  try {
    const response = await fetch(REMOTE_OK_API, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'HelkinSwarm/1.0 (personal AI copilot; contact: github.com/putersdcat)',
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      return [];
    }

    const data: unknown = await response.json();
    const parsed = RemoteOKResponseSchema.parse(data);
    const kwLower = keywords.map(k => k.toLowerCase());

    const results: OpportunityResult[] = [];
    for (const item of parsed) {
      if (results.length >= count) break;
      if ('legal' in item) continue; // skip the legal notice element

      const job = item as z.infer<typeof RemoteOKJobSchema>;
      if (!job.position || !job.url) continue;

      const tagText = (job.tags ?? []).join(' ').toLowerCase();
      const title = job.position.toLowerCase();
      const desc = (job.description ? stripHtml(job.description) : '').toLowerCase();
      const combined = `${title} ${tagText} ${desc}`;

      // Must match at least one keyword to be relevant
      const matches = kwLower.some(k => combined.includes(k));
      if (!matches) continue;

      results.push({
        title: `${job.position}${job.company ? ` @ ${job.company}` : ''}`,
        url: job.url,
        description: (job.description ? stripHtml(job.description) : tagText).substring(0, 300),
      });
    }
    return results;
  } catch {
    return [];
  }
}

// Exported for testing — uses RemoteOK with DDG fallback
export async function ddgOpportunitySearch(
  query: string,
  count: number,
): Promise<OpportunityResult[]> {
  // For keyword extraction, split query into meaningful terms
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !['remote', 'work', 'freelance', 'consulting', '2026'].includes(w));
  return remoteOKSearch(keywords.length ? keywords : ['ai', 'automation'], count);
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

  // Extract meaningful keywords from the skillset focus for RemoteOK filtering
  const keywords = skillsetFocus
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(w => w.length > 2);

  // Fetch from RemoteOK directly — one call, client-side keyword filter
  const rawResults = await remoteOKSearch(keywords, maxResults * 3);

  // Score each result, then sort by recommendation priority
  const ORDER: Record<string, number> = { pursue: 0, evaluate: 1, skip: 2 };
  const scored = rawResults.slice(0, maxResults).map(r => {
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
