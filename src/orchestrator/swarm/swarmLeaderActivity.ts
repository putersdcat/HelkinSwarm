// Swarm Leader Activity — synthesizes final answer from worker results.
// The Leader receives the chatroom transcript and produces a polished response.
// Spec ref: docs/0ze §4.3, confirmed: Leader synthesis is opportunistic
// Epic: #631

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../../llm/foundryClient.js';
import { getModelRouting } from '../../llm/modelRouter.js';
import { trackEvent } from '../../observability/telemetry.js';
import { buildLeaderSystemPrompt } from './swarmPersonas.js';
import type { ChatMessage } from '../../llm/foundryClient.js';
import type { ChatroomMessage, SwarmLeaderInput, SwarmLeaderResult } from './swarmTypes.js';

/**
 * Format the chatroom transcript into LLM-readable context.
 */
function formatTranscriptForLeader(messages: ChatroomMessage[]): string {
  if (messages.length === 0) {
    return '(No messages received from team yet)';
  }

  return messages.map(m => {
    const typeTag = m.contentType !== 'text' ? ` [${m.contentType}]` : '';
    return `[${m.from}${typeTag}] ${m.content}`;
  }).join('\n\n');
}

df.app.activity('swarmLeaderActivity', {
  handler: async (input: SwarmLeaderInput & { chatroomTranscript: ChatroomMessage[] }): Promise<SwarmLeaderResult> => {
    const routing = getModelRouting();
    // Leader uses primary model — all swarm agents use the same model
    const client = new FoundryClient({
      ...routing,
      deploymentName: routing.lane.primary,
      isReasoning: routing.lane.primary.includes('reasoning') || routing.lane.primary.startsWith('o'),
    });

    const systemPrompt = buildLeaderSystemPrompt({
      userQuery: input.userQuery,
      synthesisInstructions: input.synthesisInstructions,
      agentNames: input.agentNames,
    });

    const transcript = formatTranscriptForLeader(input.chatroomTranscript);
    const agentsHeardFrom = [...new Set(input.chatroomTranscript.map(m => m.from))];

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Here are the results from your team:\n\n${transcript}\n\nNow synthesize the final answer for the user's query: "${input.userQuery}"\n\nProduce a polished, well-structured response with all verified information.`,
      },
    ];

    trackEvent({
      name: 'SwarmLeaderStarted',
      correlationId: input.correlationId,
      userId: input.userId,
      properties: {
        agentsHeardFrom: agentsHeardFrom.join(', '),
        transcriptLength: input.chatroomTranscript.length,
        swarmId: input.swarmId,
      },
    });

    try {
      const response = await client.chatCompletion({
        messages,
        maxTokens: 8192,
        temperature: 0.7,
        correlationId: input.correlationId,
        maxBudgetMs: 60_000,
      });

      const synthesis = textContent(response.choices[0]?.message?.content);
      const totalTokens = response.usage?.totalTokens ?? 0;

      trackEvent({
        name: 'SwarmLeaderCompleted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          synthesisLength: synthesis.length,
          agentsHeardFrom: agentsHeardFrom.join(', '),
          tokensUsed: totalTokens,
        },
      });

      return {
        synthesis,
        success: true,
        tokensUsed: totalTokens,
        roundsUsed: 1,
        agentsHeardFrom,
        model: response.model,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      trackEvent({
        name: 'SwarmLeaderError',
        correlationId: input.correlationId,
        properties: { error: errorMessage },
      });
      return {
        synthesis: '',
        success: false,
        tokensUsed: 0,
        roundsUsed: 0,
        agentsHeardFrom,
        model: routing.lane.primary,
        error: errorMessage,
      };
    }
  },
});
