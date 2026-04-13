// Source-level and functional tests for per-agent model specialization (#648)
// Issue: #648

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SwarmAgentSchema, SwarmPlanSchema } from '../../src/orchestrator/swarm/swarmTypes.js';
import { buildWorkerSystemPrompt } from '../../src/orchestrator/swarm/swarmPersonas.js';

const workerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmWorkerActivity.ts'),
  'utf-8',
);

const orchestratorSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmOrchestrator.ts'),
  'utf-8',
);

const decomposerSrc = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'swarm', 'swarmDecomposerActivity.ts'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Zod schema — SwarmAgent accepts optional modelOverride + personaFile
// ---------------------------------------------------------------------------
describe('SwarmAgentSchema — model specialization fields (#648)', () => {
  it('accepts an agent with no modelOverride or personaFile (unchanged default)', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Benjamin',
      role: 'Research Specialist',
      task: 'Search the web',
      assignedTools: ['web_search'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an agent with modelOverride', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Lucas',
      role: 'Data Synthesis Specialist',
      task: 'Rank results into a table',
      assignedTools: ['web_search'],
      modelOverride: 'minimax/minimax-m2.7',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modelOverride).toBe('minimax/minimax-m2.7');
    }
  });

  it('accepts an agent with personaFile', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Lucas',
      role: 'Data Synthesis Specialist',
      task: 'Build comparison table',
      assignedTools: ['web_search'],
      personaFile: 'agentFourPersonaAlternate',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personaFile).toBe('agentFourPersonaAlternate');
    }
  });

  it('accepts an agent with both modelOverride and personaFile together', () => {
    const result = SwarmAgentSchema.safeParse({
      name: 'Lucas',
      role: 'Data Synthesis Specialist',
      task: 'Produce ranking table',
      assignedTools: ['web_search'],
      modelOverride: 'minimax/minimax-m2.7',
      personaFile: 'agentFourPersonaAlternate',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modelOverride).toBe('minimax/minimax-m2.7');
      expect(result.data.personaFile).toBe('agentFourPersonaAlternate');
    }
  });
});

// ---------------------------------------------------------------------------
// SwarmPlanSchema — modelOverride survives round-trip through the plan
// ---------------------------------------------------------------------------
describe('SwarmPlanSchema — modelOverride survives plan round-trip (#648)', () => {
  it('parses a plan with a per-agent modelOverride', () => {
    const plan = {
      swarmId: '00000000-0000-4000-8000-000000000001',
      userQuery: 'Rank these hotels by price',
      leader: { name: 'Helkin', synthesisInstructions: 'Final ranking' },
      agents: [
        {
          name: 'Benjamin',
          role: 'Researcher',
          task: 'Find prices',
          assignedTools: ['web_search'],
        },
        {
          name: 'Lucas',
          role: 'Synthesis',
          task: 'Build table',
          assignedTools: ['web_search'],
          modelOverride: 'minimax/minimax-m2.7',
          personaFile: 'agentFourPersonaAlternate',
        },
      ],
      timeoutMs: 60000,
      maxRoundsPerAgent: 4,
    };
    const result = SwarmPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[1].modelOverride).toBe('minimax/minimax-m2.7');
      expect(result.data.agents[1].personaFile).toBe('agentFourPersonaAlternate');
    }
  });
});

// ---------------------------------------------------------------------------
// Worker source — uses input.modelOverride, not hardcoded routing.lane.primary
// ---------------------------------------------------------------------------
describe('swarmWorkerActivity — model override routing (#648)', () => {
  it('uses input.modelOverride when selecting deployment name', () => {
    expect(workerSrc).toContain('input.modelOverride');
    expect(workerSrc).toContain('agentDeploymentName');
  });

  it('falls back to routing.lane.primary when modelOverride is absent', () => {
    expect(workerSrc).toContain('input.modelOverride ?? routing.lane.primary');
  });

  it('uses agentDeploymentName (not routing.lane.primary) for FoundryClient construction', () => {
    // The client must be constructed with the per-agent deployment name
    expect(workerSrc).toContain('deploymentName: agentDeploymentName');
    // routing.lane.primary must NOT appear as the direct FoundryClient deploymentName
    expect(workerSrc).not.toContain('deploymentName: routing.lane.primary');
  });

  it('reports agentDeploymentName in the success result model field', () => {
    expect(workerSrc).toContain('model: agentDeploymentName');
    expect(workerSrc).not.toContain('model: routing.lane.primary');
  });

  it('passes personaFile from input to buildWorkerSystemPrompt', () => {
    expect(workerSrc).toContain('personaFile: input.personaFile');
  });
});

// ---------------------------------------------------------------------------
// Orchestrator source — forwards modelOverride + personaFile to workerInput
// ---------------------------------------------------------------------------
describe('swarmOrchestrator — forwards specialization fields to workerInput (#648)', () => {
  it('forwards modelOverride from agent to workerInput', () => {
    expect(orchestratorSrc).toContain('modelOverride: agent.modelOverride');
  });

  it('forwards personaFile from agent to workerInput', () => {
    expect(orchestratorSrc).toContain('personaFile: agent.personaFile');
  });
});

// ---------------------------------------------------------------------------
// Decomposer source — mentions modelOverride with minimax guidance
// ---------------------------------------------------------------------------
describe('swarmDecomposerActivity — modelOverride guidance in system prompt (#648)', () => {
  it('mentions modelOverride as optional field in decomposer rules', () => {
    expect(decomposerSrc).toContain('modelOverride');
  });

  it('restricts modelOverride guidance to minimax for Lucas data synthesis', () => {
    expect(decomposerSrc).toContain('minimax/minimax-m2.7');
  });
});

// ---------------------------------------------------------------------------
// buildWorkerSystemPrompt — loads alternate persona file when personaFile provided
// ---------------------------------------------------------------------------
describe('buildWorkerSystemPrompt — personaFile override (#648)', () => {
  it('loads agentFourPersonaAlternate content when personaFile is specified', () => {
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Lucas',
      agentRole: 'Data Synthesis Specialist',
      task: 'Build comparison table',
      assignedToolNames: ['web_search'],
      allAgentNames: ['Benjamin', 'Harper', 'Lucas', 'Helkin'],
      userQuery: 'Rank coffee shops near downtown',
      personaFile: 'agentFourPersonaAlternate',
    });
    // The alternate persona mentions "ranking", "tables" etc — characteristic content
    expect(prompt.toLowerCase()).toMatch(/rank|table|synthesis|data/);
    // Should NOT be the generic fallback
    expect(prompt).not.toContain('You are Lucas, the Data Synthesis Specialist');
  });

  it('falls back to default Lucas persona when personaFile is absent', () => {
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Lucas',
      agentRole: 'Data Synthesis Specialist',
      task: 'Synthesize findings',
      assignedToolNames: ['web_search'],
      allAgentNames: ['Benjamin', 'Harper', 'Lucas', 'Helkin'],
      userQuery: 'Compare frameworks',
    });
    // Either the persona file content OR the fallback identity — both contain 'Lucas'
    expect(prompt).toContain('Lucas');
  });

  it('personaFile does not affect agentPersona behavioral guidance injection', () => {
    const customGuidance = 'Move fast. Rank by user convenience score.';
    const prompt = buildWorkerSystemPrompt({
      agentName: 'Lucas',
      agentRole: 'Data Synthesis Specialist',
      task: 'Rank options',
      assignedToolNames: ['web_search'],
      allAgentNames: ['Benjamin', 'Harper', 'Lucas', 'Helkin'],
      userQuery: 'Best coffee',
      personaFile: 'agentFourPersonaAlternate',
      agentPersona: customGuidance,
    });
    expect(prompt).toContain('Behavioral Guidance');
    expect(prompt).toContain('convenience score');
  });
});
