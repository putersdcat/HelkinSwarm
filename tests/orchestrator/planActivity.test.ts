import { describe, it, expect } from 'vitest';
import { classifyComplexity } from '../../src/orchestrator/planActivity.js';

describe('classifyComplexity', () => {
  it('returns simple for a basic question', () => {
    expect(classifyComplexity('What is the weather today?')).toBe('simple');
  });

  it('returns simple for greetings', () => {
    expect(classifyComplexity('Hello, how are you?')).toBe('simple');
  });

  it('returns compound for chained request with connector', () => {
    expect(classifyComplexity('Find my latest email and then forward it')).toBe('compound');
  });

  it('returns compound for single-connector cross-domain request', () => {
    // Single connector ("then") → compound. Domain count is irrelevant (#324).
    expect(classifyComplexity(
      'Search my email for the project update, then create a GitHub issue with the summary',
    )).toBe('compound');
  });

  it('returns complex for many sequential steps', () => {
    expect(classifyComplexity(
      'First check the weather, then search the web for flights, and finally send me an email with the results',
    )).toBe('complex');
  });
});
