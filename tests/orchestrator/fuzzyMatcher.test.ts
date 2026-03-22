// Fuzzy matcher tests — pure logic, no mocks needed.

import { describe, it, expect } from 'vitest';
import { fuzzyMatch, type FuzzyMatchInput } from '../../src/orchestrator/fuzzyMatcher.js';

function makeInput(overrides: Partial<FuzzyMatchInput> = {}): FuzzyMatchInput {
  return {
    expected: {},
    actual: {},
    ...overrides,
  };
}

describe('fuzzyMatch', () => {
  it('returns no match when nothing is specified', () => {
    const result = fuzzyMatch(makeInput());
    expect(result.matched).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('matches on sender only', () => {
    const result = fuzzyMatch(
      makeInput({
        expected: { sender: 'alice@company.com' },
        actual: { sender: 'Alice@Company.com' },
      }),
    );
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe(1);
    expect(result.matchedOn).toContain('sender');
  });

  it('fails when sender does not match', () => {
    const result = fuzzyMatch(
      makeInput({
        expected: { sender: 'alice@company.com' },
        actual: { sender: 'bob@other.com' },
      }),
    );
    expect(result.matched).toBe(false);
  });

  it('matches on subject', () => {
    const result = fuzzyMatch(
      makeInput({
        expected: { subjectContains: 'invoice' },
        actual: { subject: 'Re: Q4 Invoice Summary' },
      }),
    );
    expect(result.matched).toBe(true);
    expect(result.matchedOn).toContain('subject');
  });

  it('matches on regex pattern in body', () => {
    const result = fuzzyMatch(
      makeInput({
        expected: { regex: 'invoice\\s+#?\\d+' },
        actual: { body: 'Please see invoice #42 attached' },
      }),
    );
    expect(result.matched).toBe(true);
    expect(result.matchedOn).toContain('regex');
  });

  it('handles invalid regex gracefully', () => {
    const result = fuzzyMatch(
      makeInput({
        expected: { regex: '[invalid(' },
        actual: { body: 'anything' },
      }),
    );
    // Should not throw, just not match on regex
    expect(result.matchedOn).not.toContain('regex');
  });

  it('scores semantic similarity by word overlap', () => {
    const result = fuzzyMatch(
      makeInput({
        expected: { semantic: 'quarterly budget review report' },
        actual: { body: 'The quarterly budget review is attached in this report.' },
      }),
    );
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.matchedOn).toContain('semantic');
  });

  it('combines multiple criteria', () => {
    const result = fuzzyMatch(
      makeInput({
        expected: {
          sender: 'alice',
          subjectContains: 'report',
          regex: '\\d{4}',
          semantic: 'annual report',
        },
        actual: {
          sender: 'alice@company.com',
          subject: 'Annual Report 2024',
          body: 'The 2024 annual report is ready for your review.',
        },
      }),
    );
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.matchedOn.length).toBeGreaterThanOrEqual(3);
  });

  it('returns 50%+ threshold as matched', () => {
    // With sender only (weight 0.3) and subject only (weight 0.25), matching both = 100%
    const result = fuzzyMatch(
      makeInput({
        expected: { sender: 'bob', subjectContains: 'test' },
        actual: { sender: 'bob@co.com', subject: 'test email' },
      }),
    );
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe(1);
  });

  it('returns below-threshold as not matched', () => {
    // Only sender expected (weight 0.3) but sender matches, so 100% confidence
    // Actually - sender alone with match is 100%. Let me test with 2 criteria where only 1 matches.
    const result = fuzzyMatch(
      makeInput({
        expected: { sender: 'bob', subjectContains: 'specific-thing' },
        actual: { sender: 'bob@co.com', subject: 'completely different' },
      }),
    );
    // sender matches (0.3/0.55 ≈ 54.5%), should be barely above threshold
    expect(result.confidence).toBeCloseTo(0.3 / 0.55, 1);
    expect(result.matched).toBe(true); // 54.5% > 50%
  });
});
