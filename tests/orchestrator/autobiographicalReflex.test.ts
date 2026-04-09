import { describe, expect, it } from 'vitest';
import { buildRecentRequestRecallResponse } from '../../src/orchestrator/autobiographicalReflex.js';

describe('buildRecentRequestRecallResponse', () => {
  it('returns the last two user requests from recent history', () => {
    const result = buildRecentRequestRecallResponse(
      'what were my last two requests?',
      [
        { role: 'user', content: 'Hey buddy' },
        { role: 'assistant', content: 'Hello.' },
        { role: 'user', content: 'What is your purpose?' },
        { role: 'assistant', content: 'To help.' },
      ],
    );

    expect(result).toBe('Your last two requests were: "Hey buddy" and "What is your purpose?".');
  });

  it('returns the last single request when only one exists', () => {
    const result = buildRecentRequestRecallResponse(
      'what were my last two requests?',
      [{ role: 'user', content: 'Hey buddy' }],
    );

    expect(result).toBe('Your last request was: "Hey buddy".');
  });
});