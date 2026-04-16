// Source-level verification: swarm agents have persistent session chains and per-agent Cosmos vaults.
// Issue: #659

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

const memorySrc = readFileSync(
  join(process.cwd(), 'src', 'memory', 'memoryManager.ts'),
  'utf-8',
);

const personasSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmPersonas.ts'),
  'utf-8',
);

const commitSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmMemoryCommitActivity.ts'),
  'utf-8',
);

describe('MemoryManager — agent session vault methods (#659)', () => {
  it('exports storeAgentSessionSummary', () => {
    expect(memorySrc).toContain('async storeAgentSessionSummary(');
  });

  it('exports loadRecentAgentSessions', () => {
    expect(memorySrc).toContain('async loadRecentAgentSessions(');
  });

  it('stores agent sessions in the real sessions container', () => {
    expect(memorySrc).toContain("const SESSIONS_CONTAINER = 'sessions'");
    expect(memorySrc).toContain("type: 'agent-session-summary'");
    expect(memorySrc).toContain('agentName: normalizedAgentName');
  });

  it('loads sessions using agentName + type filter with TOP limit', () => {
    expect(memorySrc).toContain('SELECT TOP @limit c.content');
    expect(memorySrc).toContain('c.type = @type');
    expect(memorySrc).toContain('c.agentName = @agentName');
    expect(memorySrc).toContain('partitionKey: this.userId');
  });

  it('loadRecentAgentSessions defaults to limit=3', () => {
    expect(memorySrc).toContain('limit = 3');
  });
});

describe('swarmWorkerActivity — loads prior sessions at startup (#659)', () => {
  it('imports MemoryManager', () => {
    expect(workerSrc).toContain("from '../../memory/memoryManager.js'");
  });

  it('instantiates MemoryManager with userId', () => {
    expect(workerSrc).toContain('new MemoryManager(input.userId)');
  });

  it('loads recent agent sessions before building system prompt', () => {
    const sessionLoadIdx = workerSrc.indexOf('loadRecentAgentSessions(input.agentName)');
    const promptBuildIdx = workerSrc.indexOf('buildWorkerSystemPrompt(');
    expect(sessionLoadIdx).toBeGreaterThan(-1);
    expect(promptBuildIdx).toBeGreaterThan(-1);
    expect(sessionLoadIdx).toBeLessThan(promptBuildIdx);
  });

  it('session load is non-fatal (has .catch)', () => {
    expect(workerSrc).toContain("loadRecentAgentSessions(input.agentName).catch(");
  });

  it('passes priorSessionSummaries to buildWorkerSystemPrompt', () => {
    expect(workerSrc).toContain('priorSessionSummaries:');
  });

  it('persists session summary at completion', () => {
    expect(workerSrc).toContain('storeAgentSessionSummary(input.agentName,');
  });

  it('session persist is non-fatal (has .catch)', () => {
    expect(workerSrc).toContain('storeAgentSessionSummary(input.agentName, sessionSummary).catch(');
  });

  it('session summary includes swarmId, query, task, tools, and findings', () => {
    expect(workerSrc).toContain('input.swarmId');
    expect(workerSrc).toContain('input.userQuery');
    expect(workerSrc).toContain('input.task');
    expect(workerSrc).toContain('toolsUsedSet');
    expect(workerSrc).toContain('keyFindings');
  });
});

describe('swarmPersonas — injects prior session context into system prompt (#659)', () => {
  it('buildWorkerSystemPrompt accepts priorSessionSummaries parameter', () => {
    expect(personasSrc).toContain('priorSessionSummaries?: string[]');
  });

  it('injects Memory prior sessions section when summaries provided', () => {
    expect(personasSrc).toContain('Memory — Prior Sessions');
    expect(personasSrc).toContain('priorSessionSummaries');
  });
});

describe('swarmMemoryCommitActivity — per-agent vault scoping (#659)', () => {
  it('routes worker messages to agent-scoped skillId', () => {
    expect(commitSrc).toContain('agent:${msg.from.toLowerCase()}');
  });

  it('Helkin messages do not get agent: skillId (undefined for leader)', () => {
    expect(commitSrc).toContain("msg.from.toLowerCase() !== 'helkin'");
  });

  it('stores agentSkillId in skillId field', () => {
    expect(commitSrc).toContain('skillId: agentSkillId');
  });
});
