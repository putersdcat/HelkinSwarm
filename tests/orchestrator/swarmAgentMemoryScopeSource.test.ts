// Source-level verification: swarm worker recall and swarm memory commit use constructor-level agent scoping.
// Issue: #663

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

const commitSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmMemoryCommitActivity.ts'),
  'utf-8',
);

describe('swarmWorkerActivity — agent-scoped recall (#663)', () => {
  it('uses a constructor-scoped MemoryManager for agent recall', () => {
    expect(workerSrc).toContain('const agentMm = new MemoryManager(input.userId, input.agentName);');
    expect(workerSrc).toContain('const priorKnowledge = await agentMm.recall(input.task, {');
  });

  it('uses the unscoped MemoryManager only for session-chain operations', () => {
    expect(workerSrc).toContain('const sessionMm = new MemoryManager(input.userId);');
    expect(workerSrc).toContain('sessionMm.loadRecentAgentSessions(input.agentName)');
    expect(workerSrc).toContain('sessionMm.storeAgentSessionSummary(');
  });

  it('no longer relies on skillId agent hack for worker recall', () => {
    expect(workerSrc).not.toContain("skillId: `agent:${input.agentName.toLowerCase()}`");
  });
});

describe('swarmMemoryCommitActivity — agent-scoped vault writes (#663)', () => {
  it('creates agent-scoped MemoryManager instances for worker messages', () => {
    expect(commitSrc).toContain('const agentMm = new MemoryManager(userId, msg.from);');
  });

  it('skips Helkin when writing worker research to agent vaults', () => {
    expect(commitSrc).toContain("if (msg.from.toLowerCase() === 'helkin') {");
    expect(commitSrc).toContain('continue;');
  });

  it('no longer writes worker research using agent skillId in the global manager', () => {
    expect(commitSrc).not.toContain('skillId: agentSkillId');
    expect(commitSrc).not.toContain("agent:${msg.from.toLowerCase()}");
  });
});
