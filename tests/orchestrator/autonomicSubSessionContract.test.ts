import { describe, expect, it } from 'vitest';
import {
  AUTONOMIC_SUBSESSION_INVARIANT,
  buildInstrumentalSubSessionSystemPrompt,
  CONSCIOUS_THREAD_EXECUTION_KIND,
  INSTRUMENTAL_DIRECT_DISPATCH_EXECUTION_KIND,
  INSTRUMENTAL_SUB_SESSION_EXECUTION_KIND,
} from '../../src/orchestrator/autonomicSubSessionContract.js';

describe('autonomic sub-session contract', () => {
  it('exports explicit execution-kind labels for conscious and instrumental paths', () => {
    expect(CONSCIOUS_THREAD_EXECUTION_KIND).toBe('conscious-thread');
    expect(INSTRUMENTAL_SUB_SESSION_EXECUTION_KIND).toBe('instrumental-sub-session');
    expect(INSTRUMENTAL_DIRECT_DISPATCH_EXECUTION_KIND).toBe('instrumental-direct-dispatch');
  });

  it('builds a sub-session prompt that preserves the conscious-thread boundary', () => {
    const prompt = buildInstrumentalSubSessionSystemPrompt({
      toolName: 'github_create_issue',
      toolDescription: 'Create a repository issue.',
    });

    expect(AUTONOMIC_SUBSESSION_INVARIANT).toContain('allowed autonomic functions');
    expect(prompt).toContain(AUTONOMIC_SUBSESSION_INVARIANT);
    expect(prompt).toContain('instrumental sub-session delegated by the conscious thread');
    expect(prompt).toContain('minimal scoped context');
    expect(prompt).toContain('always return control and results to the conscious thread');
    expect(prompt).toContain('Do NOT call any other tools.');
    expect(prompt).toContain('Tool: github_create_issue');
  });
});