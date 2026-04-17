// Tests for swarm persona system prompt builders
// Epic: #631

import { describe, it, expect } from 'vitest';
import {
  buildLeaderSystemPrompt,
  buildWorkerSystemPrompt,
  buildLeaderDelegationPrompt,
  formatUserInfoShard,
  formatMessagingShard,
  formatReasoningShard,
  stripRenderTags,
} from '../../src/orchestrator/swarm/swarmPersonas.js';

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

// ---------------------------------------------------------------------------
// Canonical prompt shards (#672)
// ---------------------------------------------------------------------------

describe('canonical prompt shards (#672)', () => {
  const userInfo = {
    displayName: 'Eric Anderson',
    handle: 'a7f2',
    tier: 'owner',
    location: 'Prague',
  };
  const nowISO = '2026-04-16T12:34:56.000Z';

  it('formatUserInfoShard renders the canonical User Info block', () => {
    const shard = formatUserInfoShard(userInfo, nowISO);
    expect(shard).toContain('## User Info');
    expect(shard).toContain('Display Name: Eric Anderson');
    expect(shard).toContain('Handle: a7f2');
    expect(shard).toContain('Subscription Level: owner');
    expect(shard).toContain('Location: Prague');
    expect(shard).toContain(`Current time: ${nowISO}`);
  });

  it('formatUserInfoShard falls back to Unknown location', () => {
    const shard = formatUserInfoShard({ displayName: 'x', handle: 'y', tier: 'guest' }, nowISO);
    expect(shard).toContain('Location: Unknown');
  });

  it('formatMessagingShard templates the sender field per agent', () => {
    const benjamin = formatMessagingShard('Benjamin');
    expect(benjamin).toContain('Internal Messaging Convention (MANDATORY)');
    expect(benjamin).toContain('"sender":      "Benjamin"');
    expect(benjamin).toContain('"messageType"');
    expect(benjamin).toContain('"confidence"');
    const helkin = formatMessagingShard('Helkin');
    expect(helkin).toContain('"sender":      "Helkin"');
  });

  it('formatReasoningShard includes canonical preference order', () => {
    const shard = formatReasoningShard();
    expect(shard).toContain('Core Reasoning & Tool Selection Guidelines (MANDATORY)');
    expect(shard).toContain('code_execution');
    expect(shard).toContain('swarm_conversation_search');
    expect(shard).toContain('web_search');
    expect(shard).toContain('browse_page');
  });

  it('stripRenderTags removes all leader-only render components', () => {
    const input = 'See <render_inline_citation id="1"/> and also <render_searched_image url="x"/> plus <render_file name="a"/>';
    const out = stripRenderTags(input);
    expect(out).not.toContain('render_inline_citation');
    expect(out).not.toContain('render_searched_image');
    expect(out).not.toContain('render_file');
    expect(out).toContain('See');
    expect(out).toContain('and also');
  });

  it('stripRenderTags handles paired open/close tags', () => {
    const input = '<render_generated_image prompt="cat">alt</render_generated_image>';
    const out = stripRenderTags(input);
    expect(out).not.toContain('render_generated_image');
    expect(out.trim()).toBe('alt');
  });

  it('buildLeaderSystemPrompt injects canonical shards when userInfo+nowISO supplied', () => {
    const prompt = buildLeaderSystemPrompt({
      userQuery: 'test',
      synthesisInstructions: 'synthesize',
      agentNames: ['Benjamin', 'Harper'],
      userInfo,
      nowISO,
    });
    expect(prompt).toContain('## User Info');
    expect(prompt).toContain('Current time: 2026-04-16T12:34:56.000Z');
    expect(prompt).toContain('Internal Messaging Convention (MANDATORY)');
    expect(prompt).toContain('"sender":      "Helkin"');
    expect(prompt).toContain('Core Reasoning & Tool Selection Guidelines (MANDATORY)');
    expect(prompt).toContain('Render Components (Helkin-only)');
  });

  it('buildLeaderSystemPrompt omits user-info block when userInfo absent (backwards compat)', () => {
    const prompt = buildLeaderSystemPrompt({
      userQuery: 'test',
      synthesisInstructions: 'synthesize',
      agentNames: ['Benjamin'],
    });
    expect(prompt).not.toContain('## User Info');
    // Messaging + reasoning shards are still injected (user-info shard is optional)
    expect(prompt).toContain('Internal Messaging Convention (MANDATORY)');
    expect(prompt).toContain('Core Reasoning & Tool Selection Guidelines (MANDATORY)');
  });

  it('buildLeaderDelegationPrompt injects canonical shards', () => {
    const prompt = buildLeaderDelegationPrompt({
      userQuery: 'test',
      agentNames: ['Benjamin', 'Harper'],
      userInfo,
      nowISO,
    });
    expect(prompt).toContain('## User Info');
    expect(prompt).toContain('Internal Messaging Convention (MANDATORY)');
    expect(prompt).toContain('"sender":      "Helkin"');
    expect(prompt).toContain('Core Reasoning & Tool Selection Guidelines (MANDATORY)');
  });

  it('buildWorkerSystemPrompt injects sender-templated messaging shard', () => {
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Benjamin',
      agentRole: 'Research',
      task: 'research',
      assignedToolNames: ['web_search'],
      allAgentNames: ['Benjamin', 'Harper', 'Helkin'],
      userQuery: 'q',
      userInfo,
      nowISO,
    });
    expect(prompt).toContain('## User Info');
    expect(prompt).toContain('Internal Messaging Convention (MANDATORY)');
    expect(prompt).toContain('"sender":      "Benjamin"');
    expect(prompt).toContain('Core Reasoning & Tool Selection Guidelines (MANDATORY)');
    expect(prompt).toContain('Render Components are leader-only');
  });

  it('buildWorkerSystemPrompt templates each worker\u2019s own name into messaging shard', () => {
    const harper = buildWorkerSystemPrompt({
      agentName: 'Harper',
      agentRole: 'Deep Browse',
      task: 'browse',
      assignedToolNames: ['browse_page'],
      allAgentNames: ['Benjamin', 'Harper'],
      userQuery: 'q',
    });
    expect(harper).toContain('"sender":      "Harper"');
    expect(harper).not.toContain('"sender":      "Benjamin"');

    const lucas = buildWorkerSystemPrompt({
      agentName: 'Lucas',
      agentRole: 'Synthesis',
      task: 'rank',
      assignedToolNames: ['code_execution'],
      allAgentNames: ['Benjamin', 'Lucas'],
      userQuery: 'q',
    });
    expect(lucas).toContain('"sender":      "Lucas"');
  });
});
