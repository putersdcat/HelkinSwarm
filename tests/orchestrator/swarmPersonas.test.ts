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
});
