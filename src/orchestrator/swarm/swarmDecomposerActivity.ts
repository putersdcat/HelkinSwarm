// Swarm Decomposer Activity — analyzes a request and produces a SwarmPlan.
// Single LLM call using the primary model to decide agent composition.
// Spec ref: docs/0ze §4.2, docs/0zf §2
// Epic: #631

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../../llm/foundryClient.js';
import { getModelRouting, isReasoningModel } from '../../llm/modelRouter.js';
import { trackEvent } from '../../observability/telemetry.js';
import { recordOrchestratorStage } from '../../observability/orchestratorStageHealth.js';
import { toolRegistry } from '../../tools/toolRegistry.js';
import { SwarmPlanSchema } from './swarmTypes.js';
import type { SwarmAgent, SwarmDecomposerInput, SwarmDecomposerResult } from './swarmTypes.js';

// ---------------------------------------------------------------------------
// Tool-filtering + fallback — extracted for testability
// ---------------------------------------------------------------------------

/** Universal fallback tool for research agents that lost all assigned tools. */
const RESEARCH_FALLBACK_TOOL = 'web_search';

/**
 * Filter each agent's assignedTools to only valid (executable) tool names.
 * Agents that lose ALL tools get `web_search` as a fallback rather than being
 * removed entirely — a research agent with web_search can still contribute.
 *
 * Returns only agents that end up with ≥ 1 tool.
 */
export function filterAgentTools(
  agents: SwarmAgent[],
  availableToolNames: string[],
): SwarmAgent[] {
  const validTools = new Set(availableToolNames);
  const hasFallback = validTools.has(RESEARCH_FALLBACK_TOOL);

  for (const agent of agents) {
    agent.assignedTools = agent.assignedTools.filter(t => validTools.has(t));
    if (agent.assignedTools.length === 0 && hasFallback) {
      agent.assignedTools = [RESEARCH_FALLBACK_TOOL];
    }
  }

  return agents.filter(a => a.assignedTools.length > 0);
}

const DECOMPOSER_SYSTEM_PROMPT = `You are a task decomposer for a multi-agent swarm. Given a user query and available tools, decide how to split the work across 2-4 specialized agents working in parallel.

Respond with ONLY a JSON object matching this schema:
{
  "leader": {
    "name": "Helkin",
    "synthesisInstructions": "Instructions for Helkin to synthesize the final answer from all agents' findings"
  },
  "agents": [
    {
      "name": "Benjamin",
      "role": "Research & Verification Specialist",
      "task": "Specific task description for this agent",
      "assignedTools": ["tool_name_1", "tool_name_2"],
      "persona": "Precise, fast, slightly skeptical. Loves surfacing primary sources."
    }
  ],
  "timeoutMs": 60000,
  "maxRoundsPerAgent": 4
}

Rules:
- Use 2-4 agents. Prefer FEWER agents with CLEARLY DISTINCT responsibilities.
- **CRITICAL**: Each agent must research a DIFFERENT aspect of the query. Do NOT create agents with overlapping tasks.
  - BAD: Benjamin researches "performance of X", Harper researches "performance of Y" ← same dimension, different subjects
  - GOOD: Benjamin researches "technical performance benchmarks", Harper researches "ecosystem and community", Lucas researches "industry adoption and case studies" ← different dimensions
- **TOOL ASSIGNMENT — MANDATORY**: Every research agent MUST have "web_search" in assignedTools. It is the universal research backbone. Agents without web_search cannot gather external information and will produce empty results.
  - Also give "web_fetch_page" to agents that need to extract details from specific URLs.
  - "deep_research" is for multi-angle deep dives when available. Prefer web_search for breadth.
- Beyond web_search, give each agent ONLY the additional tools relevant to their specific sub-task.
- If there are only 1-2 tools available, use only 2 agents (more agents without tools just hallucinate).
- Agent names MUST be exactly these persona names: Benjamin (research/verification), Harper (tool orchestration/deep browsing), Lucas (data synthesis/alternatives). Use 2-3 of them as needed. The Leader is always Helkin.
- persona: Write 1-3 sentences of task-specific behavioral guidance for THIS agent on THIS query. What decision-making posture should they adopt? Examples: "Skeptical of marketing claims — verify pricing with direct site scraping. Prioritize primary sources over aggregators." or "Speed-focused: retrieve the top 5 results immediately and report, then dig deeper if time allows." This field is injected directly into the agent's system prompt, so make it actionable and specific to the sub-task, not generic.
- Each agent's task must be specific and actionable — not vague "research this topic".
- The Leader synthesizes — it has NO external tools. Only chatroom_send.
- For location-specific queries, ensure at least one agent searches in the local language.
- assignedTools must only contain tool names from the available tools list.
- Do NOT assign "chatroom_send" in assignedTools — all agents get it automatically.
- timeoutMs: 30000 for simple, 60000 for research, 90000 for deep multi-source.
- maxRoundsPerAgent: 2-4 depending on task depth.
- You have already been selected as the decomposer because the query was classified as multi-faceted. Your job is to DECOMPOSE it into parallel sub-tasks, not to second-guess the routing decision. Only return fallback for truly trivial single-fact lookups (e.g. "what time is it?"). Research queries, comparisons, multi-source investigations, and any query mentioning multiple topics/aspects MUST be decomposed — never return fallback for these.
- If the query is genuinely trivial (single fact, single tool call), respond with: {"fallback": true, "reason": "..."}`;

df.app.activity('swarmDecomposerActivity', {
  handler: async (input: SwarmDecomposerInput): Promise<SwarmDecomposerResult> => {
    // Update stage tracking so health endpoint shows decomposer phase
    await recordOrchestratorStage(input.correlationId, 'swarm-decompose', input.userId);

    const routing = getModelRouting();
    const client = new FoundryClient({
      ...routing,
      deploymentName: routing.lane.primary,
      isReasoning: isReasoningModel(routing.lane.primary),
    });

    const toolList = input.availableToolNames.slice(0, 40).map(name => {
      const def = toolRegistry.get(name);
      return def ? `- ${name}: ${def.description.slice(0, 100)}` : `- ${name}`;
    }).join('\n');

    // Build enriched context block from planner output (#640)
    const contextLines: string[] = [];
    if (input.complexityClass) {
      contextLines.push(`Planner complexity classification: ${input.complexityClass}`);
    }
    if (input.swarmEligibilityScore !== undefined) {
      contextLines.push(`Swarm eligibility score: ${input.swarmEligibilityScore}/10`);
    }
    if (input.activeSkillDomains && input.activeSkillDomains.length > 0) {
      contextLines.push(`Active skill domains: ${input.activeSkillDomains.join(', ')}`);
    }
    if (input.conversationSummary) {
      contextLines.push(`Conversation context: ${input.conversationSummary.slice(0, 300)}`);
    }
    const plannerContext = contextLines.length > 0
      ? `\n\nPlanner context:\n${contextLines.join('\n')}`
      : '';

    try {
      const response = await client.chatCompletion({
        messages: [
          { role: 'system', content: DECOMPOSER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Available tools:\n${toolList}${plannerContext}\n\nUser query: ${input.userMessage}`,
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

      // Filter agent tools to only executable tools, with web_search fallback
      const validAgents = filterAgentTools(parsed.data.agents, input.availableToolNames);
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
          agentTasks: plan.agents.map(a => `${a.name}: ${a.task.slice(0, 120)}`).join(' | '),
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
