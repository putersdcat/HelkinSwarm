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
// ddgOpportunitySearch (now delegates to RemoteOK)
// ---------------------------------------------------------------------------

describe('ddgOpportunitySearch', () => {
  it('returns empty array on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const results = await ddgOpportunitySearch('ai automation', 5);
    expect(results).toEqual([]);
  });

  it('returns empty array on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => [] } as Response));
    const results = await ddgOpportunitySearch('ai automation', 5);
    expect(results).toEqual([]);
  });

  it('returns matched jobs from RemoteOK response', async () => {
    const remoteOKPayload = [
      { legal: 'RemoteOK API' },
      { position: 'AI Engineer', company: 'Acme Corp', url: 'https://remoteok.com/l/123', description: 'Build AI models', tags: ['ai', 'python'] },
      { position: 'Data Scientist', company: 'Beta Inc', url: 'https://remoteok.com/l/124', description: 'Machine learning automation', tags: ['ml', 'data'] },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => remoteOKPayload,
    } as unknown as Response));

    const results = await ddgOpportunitySearch('ai engineer', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toContain('remoteok.com');
  });

  it('filters out jobs that do not match keywords', async () => {
    const remoteOKPayload = [
      { legal: 'RemoteOK API' },
      { position: 'Plumber', company: 'Pipes Corp', url: 'https://remoteok.com/l/100', description: 'Fix pipes on-site', tags: ['plumbing'] },
      { position: 'AI Researcher', company: 'AI Lab', url: 'https://remoteok.com/l/101', description: 'Research AI topics', tags: ['ai', 'research'] },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => remoteOKPayload,
    } as unknown as Response));

    const results = await ddgOpportunitySearch('research', 5);
    expect(results.every(r => r.title.toLowerCase().includes('ai') || r.url.includes('101'))).toBe(true);
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
  it('returns empty list when RemoteOK returns nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    const result = await revenue_discover_opportunities({});
    expect(Array.isArray(result.opportunities)).toBe(true);
    expect(result.count).toBe(0);
  });

  it('returns scored jobs from RemoteOK matching the skillset', async () => {
    const remoteOKPayload = [
      { legal: 'RemoteOK API' },
      { position: 'AI Research Engineer', company: 'DeepLab', url: 'https://remoteok.com/l/1', description: 'Machine learning automation research NLP', tags: ['ai', 'ml', 'research'] },
      { position: 'Content Writer', company: 'WriteCo', url: 'https://remoteok.com/l/2', description: 'Writing automation content creation', tags: ['writing', 'content'] },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => remoteOKPayload,
    } as unknown as Response));

    const result = await revenue_discover_opportunities({ skillset_focus: 'AI research writing' });
    expect(result.count).toBeGreaterThan(0);
    expect(result.opportunities[0]).toHaveProperty('score');
    expect(result.opportunities[0]).toHaveProperty('recommendation');
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

  it('sorts pursue before skip in results', async () => {
    const remoteOKPayload = [
      { legal: 'RemoteOK API' },
      // Weak signal — skip candidate (volunteer physical)
      { position: 'Volunteer Helper', company: 'NGO', url: 'https://remoteok.com/l/10', description: 'Unpaid volunteer on-site', tags: [] },
      // Strong signal — pursue candidate (AI fit, Upwork, retainer)
      { position: 'AI NLP Researcher', company: 'Upwork Client', url: 'https://remoteok.com/l/11', description: 'Upwork verified long-term retainer NLP machine learning automation', tags: ['ai', 'nlp'] },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => remoteOKPayload,
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
