// Tests for deep research skill — angle derivation + handler behavior
// Issue: #238

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deriveResearchAngles, deep_research } from '../../skills/research/handlers.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['BRAVE_SEARCH_API_KEY'];
});

// ---------------------------------------------------------------------------
// deriveResearchAngles
// ---------------------------------------------------------------------------

describe('deriveResearchAngles', () => {
  it('returns exactly 3 angles', () => {
    const angles = deriveResearchAngles('what is quantum computing?');
    expect(angles).toHaveLength(3);
  });

  it('first angle is the original question verbatim', () => {
    const question = 'Azure Durable Functions performance';
    const [first] = deriveResearchAngles(question);
    expect(first).toBe(question);
  });

  it('second angle includes background/context terms', () => {
    const [, second] = deriveResearchAngles('TypeScript ORMs');
    expect(second).toMatch(/overview|background|context/i);
  });

  it('third angle includes recency terms (2025/2026/latest)', () => {
    const [,, third] = deriveResearchAngles('LLM reasoning models');
    expect(third).toMatch(/2025|2026|latest|development/i);
  });

  it('handles "what is" prefix for core topic extraction', () => {
    const angles = deriveResearchAngles('what is serverless computing?');
    expect(angles[1]).toContain('serverless computing');
  });

  it('handles "research" prefix for core topic extraction', () => {
    const [first] = deriveResearchAngles('research competitive landscape for TypeScript ORMs');
    expect(first).toBe('research competitive landscape for TypeScript ORMs');
  });

  it('handles "how does" prefix', () => {
    const angles = deriveResearchAngles('how does Durable Functions work on ACA?');
    expect(angles[1]).toContain('Durable Functions work on ACA');
  });

  it('handles plain short topic without prefix', () => {
    const angles = deriveResearchAngles('Kubernetes');
    expect(angles[0]).toBe('Kubernetes');
    expect(angles[1]).toContain('Kubernetes');
    expect(angles[2]).toContain('Kubernetes');
  });
});

// ---------------------------------------------------------------------------
// deep_research handler — mocked fetch (Brave Search API path)
// ---------------------------------------------------------------------------

describe('deep_research (Brave API path)', () => {
  const mockBraveResult = {
    web: {
      results: [
        { title: 'Result One', url: 'https://example.com/1', description: 'First test result' },
        { title: 'Result Two', url: 'https://example.com/2', description: 'Second test result' },
      ],
    },
  };

  beforeEach(() => {
    process.env['BRAVE_SEARCH_API_KEY'] = 'test-brave-key-12345';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockBraveResult),
    } as Response);
  });

  it('returns a string containing the research question', async () => {
    const result = await deep_research({ question: 'Azure Durable Functions' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Azure Durable Functions');
  });

  it('fans out to 3 search angles by default', async () => {
    await deep_research({ question: 'containerized workloads' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it('uses provided custom angles instead of derived ones', async () => {
    await deep_research({
      question: 'test question',
      angles: ['custom angle 1', 'custom angle 2'],
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('respects sourcesPerAngle parameter in the URL', async () => {
    await deep_research({ question: 'Azure', sourcesPerAngle: 3 });
    const calls = vi.mocked(fetch).mock.calls;
    for (const [url] of calls) {
      expect(url as string).toContain('count=3');
    }
  });

  it('deduplicates the same URL appearing in multiple angles', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        web: {
          results: [
            { title: 'Duplicate', url: 'https://example.com/same', description: 'same result' },
          ],
        },
      }),
    } as Response);

    const result = (await deep_research({
      question: 'dedup test',
      angles: ['q1', 'q2', 'q3'],
    })) as string;

    const occurrences = (result.match(/example\.com\/same/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('handles individual search failures gracefully (Promise.allSettled)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network failure'));
    const result = await deep_research({ question: 'failing query' });
    // Should not throw — returns string with 0 sources
    expect(typeof result).toBe('string');
  });

  it('includes source count summary line in output', async () => {
    const result = (await deep_research({ question: 'summary line test' })) as string;
    // formatResearchOutput always adds "N unique sources collected" footer
    expect(result).toMatch(/unique sources collected/);
  });

  it('throws Zod error on empty question', async () => {
    await expect(deep_research({ question: '' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// deep_research handler — DuckDuckGo fallback path
// ---------------------------------------------------------------------------

describe('deep_research (DuckDuckGo fallback)', () => {
  const mockDdgResult = {
    Abstract: 'A detailed abstract from Wikipedia about the topic.',
    AbstractURL: 'https://en.wikipedia.org/wiki/Test',
    AbstractSource: 'Wikipedia',
    Heading: 'Test Heading',
    RelatedTopics: [
      { Text: 'Related item one - Description for item one', FirstURL: 'https://ddg.example.com/rel1' },
      { Text: 'Related item two - Description for item two', FirstURL: 'https://ddg.example.com/rel2' },
    ],
  };

  beforeEach(() => {
    // No BRAVE key → DuckDuckGo path is used
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDdgResult),
    } as Response);
  });

  it('falls back to DuckDuckGo when BRAVE_SEARCH_API_KEY is absent', async () => {
    const result = (await deep_research({ question: 'fallback test' })) as string;
    expect(result).toContain('wikipedia.org');
  });

  it('falls back to DuckDuckGo when BRAVE key is "not-configured"', async () => {
    process.env['BRAVE_SEARCH_API_KEY'] = 'not-configured';
    const result = (await deep_research({ question: 'not-configured key test' })) as string;
    expect(result).toContain('wikipedia.org');
  });

  it('handles DuckDuckGo fetch failure gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DDG error'));
    const result = await deep_research({ question: 'ddg failure test' });
    expect(typeof result).toBe('string');
  });

  it('handles DuckDuckGo non-ok response gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({}),
    } as Response);
    // Should not throw — falls back silently
    const result = await deep_research({ question: 'non-ok response test', angles: ['test angle'] });
    expect(typeof result).toBe('string');
  });
});
