import { describe, it, expect } from 'vitest';
import { classifyComplexity } from '../../src/orchestrator/planActivity.js';

const TOOL_NAMES = [
  'outlook_list_emails', 'outlook_send_email', 'outlook_read_email',
  'github_create_issue', 'web_search', 'weather_get_forecast',
  'teams_get_message_reactions', 'core_help',
];

describe('classifyComplexity', () => {
  it('returns simple for a basic question', () => {
    expect(classifyComplexity('What is the weather today?', TOOL_NAMES)).toBe('simple');
  });

  it('returns simple for greetings', () => {
    expect(classifyComplexity('Hello, how are you?', TOOL_NAMES)).toBe('simple');
  });

  it('returns compound for single-domain chained request', () => {
    expect(classifyComplexity('Find my latest email and then forward it', TOOL_NAMES)).toBe('compound');
  });

  it('returns complex for multi-domain request', () => {
    expect(classifyComplexity(
      'Search my email for the project update, then create a GitHub issue with the summary',
      TOOL_NAMES,
    )).toBe('complex');
  });

  it('returns complex for many sequential steps', () => {
    expect(classifyComplexity(
      'First check the weather, then search the web for flights, and finally send me an email with the results',
      TOOL_NAMES,
    )).toBe('complex');
  });
});
