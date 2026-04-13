// Tests for swarm persona system prompt builders
// Epic: #631

import { describe, it, expect } from 'vitest';
import { buildLeaderSystemPrompt, buildWorkerSystemPrompt } from '../../src/orchestrator/swarm/swarmPersonas.js';

describe('buildLeaderSystemPrompt', () => {
  it('includes synthesis instructions', () => {
    const prompt = buildLeaderSystemPrompt({
      userQuery: 'Compare React and Vue',
      synthesisInstructions: 'Create a structured comparison table',
      agentNames: ['Alpha', 'Beta'],
    });
    expect(prompt).toContain('Create a structured comparison table');
    expect(prompt).toContain('Compare React and Vue');
    expect(prompt).toContain('Alpha');
    expect(prompt).toContain('Beta');
  });

  it('emphasizes no external tool use', () => {
    const prompt = buildLeaderSystemPrompt({
      userQuery: 'test',
      synthesisInstructions: 'synthesize',
      agentNames: ['Alpha'],
    });
    expect(prompt.toLowerCase()).toContain('do not');
    // Leader should not call tools
    expect(prompt.toLowerCase()).toMatch(/no.*tool|do not.*tool/);
  });
});

describe('buildWorkerSystemPrompt', () => {
  it('includes assigned tools', () => {
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Alpha',
      agentRole: 'Research Specialist',
      task: 'Find papers on AI alignment',
      assignedToolNames: ['github_search_issues', 'outlook_list_emails'],
      allAgentNames: ['Alpha', 'Beta', 'Leader'],
      userQuery: 'Research AI alignment methods',
    });
    expect(prompt).toContain('github_search_issues');
    expect(prompt).toContain('outlook_list_emails');
    expect(prompt).toContain('Alpha');
    expect(prompt).toContain('Research Specialist');
  });

  it('includes chatroom_send instructions', () => {
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Beta',
      agentRole: 'Analyst',
      task: 'Analyze data',
      assignedToolNames: ['helkin_current_datetime'],
      allAgentNames: ['Beta', 'Leader'],
      userQuery: 'test',
    });
    expect(prompt).toContain('chatroom_send');
  });

  it('injects non-default agentPersona as Behavioral Guidance (#651)', () => {
    const customPersona = 'You are a skeptical fact-checker. Verify every claim with at least two sources.';
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Benjamin',
      agentRole: 'Research Specialist',
      task: 'Find recent AI papers',
      assignedToolNames: ['web_search'],
      allAgentNames: ['Benjamin', 'Harper', 'Helkin'],
      userQuery: 'Research AI safety',
      agentPersona: customPersona,
    });
    expect(prompt).toContain('Behavioral Guidance');
    expect(prompt).toContain('skeptical fact-checker');
    expect(prompt).toContain('Verify every claim');
  });

  it('does NOT inject the default placeholder persona (#651)', () => {
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Harper',
      agentRole: 'Tool Orchestration',
      task: 'Browse the web',
      assignedToolNames: ['web_fetch_page'],
      allAgentNames: ['Harper', 'Helkin'],
      userQuery: 'Find pricing',
      agentPersona: 'Focused and thorough research agent',
    });
    expect(prompt).not.toContain('Behavioral Guidance');
    // Default placeholder should not appear as an injected section
    expect(prompt).not.toContain('Focused and thorough research agent');
  });

  it('does NOT inject Behavioral Guidance when agentPersona is absent (#651)', () => {
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Lucas',
      agentRole: 'Data Synthesis',
      task: 'Rank alternatives',
      assignedToolNames: ['helkin_current_datetime'],
      allAgentNames: ['Lucas', 'Helkin'],
      userQuery: 'Compare options',
    });
    expect(prompt).not.toContain('Behavioral Guidance');
  });

  it('trims whitespace from agentPersona before injection (#651)', () => {
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Benjamin',
      agentRole: 'Research',
      task: 'Research topic',
      assignedToolNames: [],
      allAgentNames: ['Benjamin', 'Helkin'],
      userQuery: 'topic',
      agentPersona: '   Be extremely concise. No fluff.   ',
    });
    expect(prompt).toContain('Behavioral Guidance');
    expect(prompt).toContain('Be extremely concise. No fluff.');
    // Should not have leading/trailing whitespace in the injected section
    expect(prompt).not.toContain('   Be extremely concise');
  });
});
