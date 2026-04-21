// Tests for swarm decomposer tool-filtering and fallback logic.
// Spec ref: docs/0ze §4.2, docs/0zf §2
// Issue: #632

import { describe, it, expect } from 'vitest';
import { ensureFullSwarmRoster, filterAgentTools } from '../../src/orchestrator/swarm/swarmDecomposerActivity.js';
import type { SwarmAgent } from '../../src/orchestrator/swarm/swarmTypes.js';

function makeAgent(name: string, tools: string[]): SwarmAgent {
  return {
    name,
    role: `${name} specialist`,
    task: `Research ${name.toLowerCase()} dimension`,
    assignedTools: tools,
    persona: `You are ${name}.`,
  };
}

describe('filterAgentTools', () => {
  const available = ['web_search', 'web_fetch_page', 'deep_research', 'github_search_issues'];

  it('keeps agents with valid tools', () => {
    const agents = [
      makeAgent('Alpha', ['web_search', 'deep_research']),
      makeAgent('Beta', ['github_search_issues']),
    ];
    const result = filterAgentTools(agents, available);
    expect(result).toHaveLength(2);
    expect(result[0].assignedTools).toEqual(['web_search', 'deep_research']);
    expect(result[1].assignedTools).toEqual(['github_search_issues']);
  });

  it('strips invalid tool names', () => {
    const agents = [makeAgent('Alpha', ['web_search', 'totally_fake_tool'])];
    const result = filterAgentTools(agents, available);
    expect(result[0].assignedTools).toEqual(['web_search']);
  });

  it('gives web_search fallback to agents that lost all tools', () => {
    const agents = [
      makeAgent('Alpha', ['web_search']),
      makeAgent('Beta', ['nonexistent_tool_1', 'nonexistent_tool_2']),
    ];
    const result = filterAgentTools(agents, available);
    expect(result).toHaveLength(2);
    expect(result[1].assignedTools).toEqual(['web_search']);
  });

  it('removes agents with no tools when web_search is also unavailable', () => {
    const noWebSearch = ['deep_research'];
    const agents = [
      makeAgent('Alpha', ['deep_research']),
      makeAgent('Beta', ['nonexistent_tool']),
    ];
    const result = filterAgentTools(agents, noWebSearch);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alpha');
  });

  it('returns empty array when all agents lose tools and no web_search', () => {
    const agents = [
      makeAgent('Alpha', ['fake_1']),
      makeAgent('Beta', ['fake_2']),
    ];
    const result = filterAgentTools(agents, ['deep_research']);
    expect(result).toHaveLength(0);
  });

  it('preserves valid tools and adds no fallback when agent already has tools', () => {
    const agents = [makeAgent('Alpha', ['web_search', 'fake_tool'])];
    const result = filterAgentTools(agents, available);
    expect(result[0].assignedTools).toEqual(['web_search']);
  });
});

describe('ensureFullSwarmRoster', () => {
  const available = ['web_search', 'web_fetch_page', 'deep_research'];

  it('repairs a partial plan to the full Benjamin/Harper/Lucas roster (#692)', () => {
    const repaired = ensureFullSwarmRoster([
      makeAgent('Benjamin', ['web_search']),
      makeAgent('Lucas', ['deep_research']),
    ], 'compare frameworks', available);

    expect(repaired.map((agent) => agent.name)).toEqual(['Benjamin', 'Harper', 'Lucas']);
    expect(repaired.every((agent) => agent.assignedTools.length > 0)).toBe(true);
  });
});

describe('DECOMPOSER_SYSTEM_PROMPT — source verification', () => {
  // Verify the prompt instructs the decomposer to write task-specific persona guidance (#651 follow-on)
  it('instructs decomposer to write task-specific behavioral personas', () => {
    // Source-level check — read the activity file directly to confirm the rule is present
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmDecomposerActivity.ts'),
      'utf-8',
    );
    expect(src).toContain('task-specific behavioral guidance');
    expect(src).toContain('injected directly into the agent\'s system prompt');
    expect(src).toContain('Use EXACTLY 3 worker agents every time');
    expect(src).toContain('Use ALL THREE on every swarm turn');
  });

  it('prepends critical research tools so the visibility cap never drops web_search (#694)', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmDecomposerActivity.ts'),
      'utf-8',
    );
    // Priority list must exist and include web_search as the first research tool
    expect(src).toContain('PRIORITY_RESEARCH_TOOLS');
    expect(src).toMatch(/PRIORITY_RESEARCH_TOOLS\s*=\s*\[[\s\S]*?'web_search'/);
    expect(src).toContain("'web_fetch_page'");
    expect(src).toContain("'deep_research'");
    // Cap must be ≥ 100 (current catalogue is ~101 tools)
    expect(src).toMatch(/slice\(0,\s*100\)/);
    // The old bug — slice(0, 40) — must be gone
    expect(src).not.toMatch(/availableToolNames\.slice\(0,\s*40\)/);
  });
});
