// Input canonicalizer tests — pure logic, no mocks needed.
// Issue: #153 discovery, #270 refactor

import { describe, it, expect } from 'vitest';
import { canonicalizeInput } from '../../src/orchestrator/inputCanonicalizer.js';

describe('inputCanonicalizer', () => {
  it('extracts email from angle brackets', () => {
    const result = canonicalizeInput('Send to Bob Smith <bob@company.com> please');
    expect(result.text).toBe('Send to Bob Smith bob@company.com please');
    expect(result.changes.some(c => c.description.includes('bob@company.com'))).toBe(true);
  });

  it('fixes UPN whitespace', () => {
    const result = canonicalizeInput('email eric.anderson @domain.com');
    expect(result.text).toContain('eric.anderson@domain.com');
  });

  it('collapses excessive whitespace', () => {
    const result = canonicalizeInput('hello    world\n\n\n\nfoo');
    expect(result.text).toBe('hello world\n\nfoo');
  });

  it('uppercases Jira-style keys', () => {
    const result = canonicalizeInput('fixes issue helm-123 in sprint');
    expect(result.text).toContain('HELM-123');
  });

  it('normalizes known git refs to lowercase', () => {
    const result = canonicalizeInput('merge Main into feature');
    expect(result.text).toContain('merge main');
  });

  it('leaves unknown git refs unchanged', () => {
    const result = canonicalizeInput('checkout MyFeatureBranch');
    // "MyFeatureBranch" is preceded by "checkout" but is not a known ref
    expect(result.text).toContain('MyFeatureBranch');
  });

  it('returns empty changes array for clean input', () => {
    const result = canonicalizeInput('hello world');
    expect(result.changes).toHaveLength(0);
    expect(result.text).toBe('hello world');
  });

  it('applies all rules in sequence', () => {
    const result = canonicalizeInput('Send to <alice@co.com> and branch Main  fixes helm-42');
    expect(result.text).toContain('alice@co.com');
    expect(result.text).toContain('HELM-42');
    expect(result.changes.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves original text (#270)', () => {
    const input = 'Send to <alice@co.com> and  extra spaces';
    const result = canonicalizeInput(input);
    expect(result.originalText).toBe(input);
    expect(result.text).not.toBe(input);
  });

  it('changes include rule names (#270)', () => {
    const result = canonicalizeInput('Send to <alice@co.com>');
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.changes[0].rule).toBe('angle-bracket-email');
    expect(result.changes[0].description).toContain('alice@co.com');
  });

  it('accepts modality parameter (#270)', () => {
    const result = canonicalizeInput('hello world', 'voice');
    expect(result.text).toBe('hello world');
    expect(result.changes).toHaveLength(0);
  });
});
