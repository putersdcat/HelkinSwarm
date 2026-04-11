// Tests for revenue discovery skill handlers
// Issue: #249

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  scoreOpportunity,
  overallRecommendation,
  ddgOpportunitySearch,
  revenue_discover_opportunities,
  revenue_score_opportunity,
} from '../../skills/revenue/handlers.js';
import type { OpportunityScore } from '../../skills/revenue/handlers.js';

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// scoreOpportunity
// ---------------------------------------------------------------------------

describe('scoreOpportunity', () => {
  it('returns high value_potential for retainer/contract-rate terms', () => {
    const score = scoreOpportunity('Senior AI Consultant', 'Long-term retainer contract rate');
    expect(score.value_potential).toBe('high');
  });

  it('returns low value_potential for unpaid/volunteer terms', () => {
    const score = scoreOpportunity('Volunteer AI helper', 'unpaid internship for students');
    expect(score.value_potential).toBe('low');
  });

  it('returns medium value_potential for neutral description', () => {
    const score = scoreOpportunity('Freelance task', 'Write 10 product descriptions');
    expect(score.value_potential).toBe('medium');
  });

  it('returns high skill_fit for AI/automation terms', () => {
    const score = scoreOpportunity('AI chatbot developer', 'Build language model automation pipeline');
    expect(score.skill_fit).toBe('high');
  });

  it('returns low skill_fit for physical/on-site terms', () => {
    const score = scoreOpportunity('Construction foreman', 'On-site manual labor heavy construction');
    expect(score.skill_fit).toBe('low');
  });

  it('returns low risk for Upwork platform reference', () => {
    const score = scoreOpportunity('Upwork freelance AI project', 'Verified client on Upwork.com');
    expect(score.risk_level).toBe('low');
  });

  it('returns high risk for equity-only startup', () => {
    const score = scoreOpportunity('Join our startup!', 'equity revenue share unproven new platform');
    expect(score.risk_level).toBe('high');
  });

  it('returns low effort for quick/one-time tasks', () => {
    const score = scoreOpportunity('Quick task needed', 'One-time simple task, 1 hour max');
    expect(score.effort_level).toBe('low');
  });

  it('returns high effort for full-time management roles', () => {
    const score = scoreOpportunity('Full time AI Director', 'Full-time 40 hours ongoing management');
    expect(score.effort_level).toBe('high');
  });

  it('returns medium for all fields when no specific terms match', () => {
    const score = scoreOpportunity('Generic job posting', 'Do some work for us');
    expect(score.value_potential).toBe('medium');
    expect(score.skill_fit).toBe('medium');
    expect(score.risk_level).toBe('medium');
    expect(score.effort_level).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// overallRecommendation
// ---------------------------------------------------------------------------

describe('overallRecommendation', () => {
  it('returns pursue for a best-case score', () => {
    const score: OpportunityScore = {
      value_potential: 'high',
      skill_fit: 'high',
      risk_level: 'low',
      effort_level: 'low',
    };
    expect(overallRecommendation(score)).toBe('pursue');
  });

  it('returns skip for a worst-case score', () => {
    const score: OpportunityScore = {
      value_potential: 'low',
      skill_fit: 'low',
      risk_level: 'high',
      effort_level: 'high',
    };
    expect(overallRecommendation(score)).toBe('skip');
  });

  it('returns evaluate for a mixed score', () => {
    const score: OpportunityScore = {
      value_potential: 'medium',
      skill_fit: 'medium',
      risk_level: 'medium',
      effort_level: 'medium',
    };
    // total = 1 + 1 + (2-1) + (2-1) = 4 → evaluate
    expect(overallRecommendation(score)).toBe('evaluate');
  });

  it('returns pursue for high value/fit with medium risk/effort', () => {
    const score: OpportunityScore = {
      value_potential: 'high',
      skill_fit: 'high',
      risk_level: 'medium',
      effort_level: 'medium',
    };
    // total = 2 + 2 + 1 + 1 = 6 → pursue
    expect(overallRecommendation(score)).toBe('pursue');
  });
});

// ---------------------------------------------------------------------------
// ddgOpportunitySearch
// ---------------------------------------------------------------------------

describe('ddgOpportunitySearch', () => {
  it('returns empty array on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const results = await ddgOpportunitySearch('test query', 5);
    expect(results).toEqual([]);
  });

  it('returns empty array on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response));
    const results = await ddgOpportunitySearch('test query', 5);
    expect(results).toEqual([]);
  });

  it('returns abstract result when DDG returns Abstract', async () => {
    const ddgPayload = {
      Abstract: 'Freelance AI development opportunities worldwide.',
      AbstractURL: 'https://example.com/freelance-ai',
      AbstractSource: 'Wikipedia',
      Heading: 'Freelance AI Development',
      RelatedTopics: [],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ddgPayload,
    } as unknown as Response));

    const results = await ddgOpportunitySearch('freelance AI', 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Freelance AI Development (Wikipedia)');
    expect(results[0].url).toBe('https://example.com/freelance-ai');
  });

  it('deduplicates results by URL when count > available', async () => {
    const ddgPayload = {
      RelatedTopics: [
        { Text: 'Topic A - First topic', FirstURL: 'https://example.com/a' },
        { Text: 'Topic B - Second topic', FirstURL: 'https://example.com/b' },
        { Text: 'Topic C - Third topic', FirstURL: 'https://example.com/c' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ddgPayload,
    } as unknown as Response));

    const results = await ddgOpportunitySearch('freelance', 2);
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// revenue_score_opportunity (tool)
// ---------------------------------------------------------------------------

describe('revenue_score_opportunity', () => {
  it('throws when both title and description are missing', async () => {
    await expect(revenue_score_opportunity({})).rejects.toThrow(
      'At least one of title or description must be provided',
    );
  });

  it('returns pursue for a strong AI consulting opportunity', async () => {
    const result = await revenue_score_opportunity({
      title: 'Senior AI Research Consultant',
      description: 'Upwork verified client, long-term retainer, NLP and machine learning research automation',
    });
    expect(result.recommendation).toBe('pursue');
    expect(result.score.skill_fit).toBe('high');
    expect(result.score.value_potential).toBe('high');
    expect(result.score.risk_level).toBe('low');
  });

  it('returns skip for a poor-fit physical labor role', async () => {
    const result = await revenue_score_opportunity({
      title: 'Construction Worker',
      description: 'On-site manual labor, welding and plumbing, unpaid trial week',
    });
    expect(result.recommendation).toBe('skip');
    expect(result.score.skill_fit).toBe('low');
  });

  it('returns structured explanation with positives and negatives', async () => {
    const result = await revenue_score_opportunity({
      title: 'High-risk startup equity deal',
      description: 'AI writing automation, equity only revenue share startup unproven',
    });
    expect(result.explanation).toContain('concerns:');
    expect(result.explanation).toContain('high-risk');
    expect(result.score.skill_fit).toBe('high'); // AI writing is a fit
  });

  it('returns neutral explanation for no strong signals', async () => {
    const result = await revenue_score_opportunity({
      title: 'Generic task',
      description: 'Do some work',
    });
    expect(result.explanation).toContain('neutral');
  });

  it('uses untitled placeholder when only description provided', async () => {
    const result = await revenue_score_opportunity({ title: '', description: 'AI research project' });
    expect(result.title).toBe('(untitled)');
  });
});

// ---------------------------------------------------------------------------
// revenue_discover_opportunities (tool)
// ---------------------------------------------------------------------------

describe('revenue_discover_opportunities', () => {
  it('returns empty list when DDG returns nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    const result = await revenue_discover_opportunities({});
    expect(Array.isArray(result.opportunities)).toBe(true);
    expect(result.count).toBe(0);
  });

  it('deduplicates results from multiple search angles', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      // First 2 angles return the same URL, third returns unique
      const url = callCount <= 2 ? 'https://example.com/shared' : 'https://example.com/unique';
      return {
        ok: true,
        json: async () => ({
          Abstract: 'AI research opportunity',
          AbstractURL: url,
          AbstractSource: 'Test',
          Heading: 'AI Freelance',
          RelatedTopics: [],
        }),
      } as unknown as Response;
    }));

    const result = await revenue_discover_opportunities({ max_results: 10 });
    // Should deduplicate the shared URL across angles
    const urls = result.opportunities.map((o: { url: string }) => o.url);
    const unique = new Set(urls);
    expect(urls.length).toBe(unique.size);
  });

  it('respects max_results cap of 20', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    const result = await revenue_discover_opportunities({ max_results: 999 });
    expect(result.count).toBeLessThanOrEqual(20);
  });

  it('uses provided skillset_focus in result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    const result = await revenue_discover_opportunities({ skillset_focus: 'translation' });
    expect(result.skillset_focus).toBe('translation');
  });

  it('sorts pursue before evaluate before skip', async () => {
    // Return 3 results: one neutral (evaluate), one strong AI fit (pursue), one bad (skip)
    const topics = [
      { Text: 'Generic admin work - some task', FirstURL: 'https://example.com/1' },
      { Text: 'Upwork AI research automation - NLP machine learning', FirstURL: 'https://example.com/2' },
      { Text: 'Unpaid volunteer construction on-site', FirstURL: 'https://example.com/3' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ RelatedTopics: topics }),
    } as unknown as Response));

    const result = await revenue_discover_opportunities({ max_results: 10 });
    const recs = result.opportunities.map((o: { recommendation: string }) => o.recommendation);
    const pursueIdx = recs.indexOf('pursue');
    const skipIdx = recs.indexOf('skip');
    if (pursueIdx !== -1 && skipIdx !== -1) {
      expect(pursueIdx).toBeLessThan(skipIdx);
    }
  });
});
