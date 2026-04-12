// Swarm Decomposer Activity — analyzes a request and produces a SwarmPlan.
// Single LLM call using the primary model to decide agent composition.
// Spec ref: docs/0ze §4.2, docs/0zf §2
// Epic: #631

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../../llm/foundryClient.js';
import { getModelRouting } from '../../llm/modelRouter.js';
import { trackEvent } from '../../observability/telemetry.js';
import { recordOrchestratorStage } from '../../observability/orchestratorStageHealth.js';
import { SwarmPlanSchema } from './swarmTypes.js';
import type { SwarmDecomposerInput, SwarmDecomposerResult } from './swarmTypes.js';

const DECOMPOSER_SYSTEM_PROMPT = `You are a task decomposer for a multi-agent swarm. Given a user query and available tools, decide how to split the work across 2-4 specialized agents working in parallel.

Respond with ONLY a JSON object matching this schema:
{
  "leader": {
    "name": "Leader",
    "synthesisInstructions": "Instructions for the Leader to synthesize the final answer from all agents' findings"
  },
  "agents": [
    {
      "name": "Alpha",
      "role": "Research Specialist",
      "task": "Specific task description for this agent",
      "assignedTools": ["tool_name_1", "tool_name_2"],
      "persona": "One-line personality/style hint"
    }
  ],
  "timeoutMs": 60000,
  "maxRoundsPerAgent": 4
}

Rules:
- Use 2-4 agents. Prefer FEWER agents with CLEARLY DISTINCT responsibilities.
- **CRITICAL**: Each agent must research a DIFFERENT aspect of the query. Do NOT create agents with overlapping tasks.
  - BAD: Alpha researches "performance of X", Beta researches "performance of Y" ← same dimension, different subjects
  - GOOD: Alpha researches "technical performance benchmarks", Beta researches "ecosystem and community", Gamma researches "industry adoption and case studies" ← different dimensions
- Each agent gets ONLY the tools relevant to their specific task. Do not give all tools to all agents.
- If there are only 1-2 tools available, use only 2 agents (more agents without tools just hallucinate).
- Agent names should be short and distinct (Alpha, Beta, Gamma, Delta).
- Each agent's task must be specific and actionable — not vague "research this topic".
- The Leader synthesizes — it has NO external tools. Only chatroom_send.
- For location-specific queries, ensure at least one agent searches in the local language.
- assignedTools must only contain tool names from the available tools list.
- Do NOT assign "chatroom_send" in assignedTools — all agents get it automatically.
- timeoutMs: 30000 for simple, 60000 for research, 90000 for deep multi-source.
- maxRoundsPerAgent: 2-4 depending on task depth.
- If the query is too simple for a swarm (single tool call would suffice), respond with: {"fallback": true, "reason": "..."}`;

df.app.activity('swarmDecomposerActivity', {
  handler: async (input: SwarmDecomposerInput): Promise<SwarmDecomposerResult> => {
    // Update stage tracking so health endpoint shows decomposer phase
    await recordOrchestratorStage(input.correlationId, 'swarm-decompose', input.userId);

    const routing = getModelRouting();
    const client = new FoundryClient({
      ...routing,
      deploymentName: routing.lane.primary,
      isReasoning: routing.lane.primary.includes('reasoning') || routing.lane.primary.startsWith('o'),
    });

    const toolList = input.availableToolNames.slice(0, 60).join(', ');

    try {
      const response = await client.chatCompletion({
        messages: [
          { role: 'system', content: DECOMPOSER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Available tools: ${toolList}\n\nUser query: ${input.userMessage}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 1500,
        correlationId: input.correlationId,
        maxBudgetMs: 30_000,
      });

      const content = textContent(response.choices[0]?.message?.content);
      const tokensUsed = response.usage?.totalTokens ?? 0;
      const model = response.model;

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        trackEvent({
          name: 'SwarmDecomposerParseError',
          correlationId: input.correlationId,
          properties: { snippet: content.slice(0, 200) },
        });
        return {
          plan: null,
          tokensUsed,
          decomposerModel: model,
          fallbackReason: 'Failed to parse decomposer response as JSON',
        };
      }

      const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      // Check if decomposer says fallback
      if ('fallback' in raw && raw.fallback === true) {
        return {
          plan: null,
          tokensUsed,
          decomposerModel: model,
          fallbackReason: typeof raw.reason === 'string' ? raw.reason : 'Decomposer chose sequential',
        };
      }

      // Augment with generated fields
      const planCandidate = {
        swarmId: crypto.randomUUID(),
        userQuery: input.userMessage,
        ...raw,
      };

      // Validate with Zod
      const parsed = SwarmPlanSchema.safeParse(planCandidate);
      if (!parsed.success) {
        trackEvent({
          name: 'SwarmDecomposerValidationError',
          correlationId: input.correlationId,
          properties: {
            errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
            snippet: content.slice(0, 300),
          },
        });
        return {
          plan: null,
          tokensUsed,
          decomposerModel: model,
          fallbackReason: `SwarmPlan validation failed: ${parsed.error.issues[0]?.message}`,
        };
      }

      // Filter agent tools to only valid tools
      const validTools = new Set(input.availableToolNames);
      for (const agent of parsed.data.agents) {
        agent.assignedTools = agent.assignedTools.filter(t => validTools.has(t));
      }

      // Remove agents with no valid tools
      const validAgents = parsed.data.agents.filter(a => a.assignedTools.length > 0);
      if (validAgents.length === 0) {
        return {
          plan: null,
          tokensUsed,
          decomposerModel: model,
          fallbackReason: 'No agents had valid tools after filtering',
        };
      }

      const plan = { ...parsed.data, agents: validAgents };

      trackEvent({
        name: 'SwarmPlanGenerated',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          agentCount: plan.agents.length,
          totalTools: plan.agents.reduce((sum, a) => sum + a.assignedTools.length, 0),
          timeoutMs: plan.timeoutMs,
          maxRoundsPerAgent: plan.maxRoundsPerAgent,
          agents: plan.agents.map(a => `${a.name}(${a.role})[${a.assignedTools.join(',')}]`).join(' | '),
          leaderInstructions: plan.leader.synthesisInstructions.slice(0, 200),
        },
      });

      return {
        plan,
        tokensUsed,
        decomposerModel: model,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      trackEvent({
        name: 'SwarmDecomposerError',
        correlationId: input.correlationId,
        properties: { error: errorMessage },
      });
      return {
        plan: null,
        tokensUsed: 0,
        decomposerModel: 'error',
        fallbackReason: `Decomposer failed: ${errorMessage}`,
      };
    }
  },
});
