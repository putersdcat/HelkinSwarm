// Swarm Leader Activity — synthesizes final answer from worker results.
// The Leader receives the chatroom transcript and produces a polished response.
// Spec ref: docs/0ze §4.3, confirmed: Leader synthesis is opportunistic
// Epic: #631

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../../llm/foundryClient.js';
import { getModelRouting, isReasoningModel } from '../../llm/modelRouter.js';
import { trackEvent } from '../../observability/telemetry.js';
import { recordOrchestratorStage } from '../../observability/orchestratorStageHealth.js';
import { buildLeaderSystemPrompt, buildLeaderDelegationPrompt } from './swarmPersonas.js';
import type { ChatMessage, ToolDefinition } from '../../llm/foundryClient.js';
import type { ChatroomMessage, SwarmLeaderInput, SwarmLeaderResult } from './swarmTypes.js';
import { ChatroomMessageSchema } from './swarmTypes.js';

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
      isReasoning: isReasoningModel(routing.lane.primary),
    });

    const agentsHeardFrom = [...new Set(input.chatroomTranscript.map(m => m.from))];

    // -----------------------------------------------------------------------
    // Delegation mode (#644 Slice 2 / #645): Leader reviews initial transcript,
    // identifies gaps, and sends targeted follow-up via chatroom_send.
    // Does NOT produce final synthesis — that runs in standard mode.
    // -----------------------------------------------------------------------
    if (input.delegationMode) {
      await recordOrchestratorStage(input.correlationId, 'swarm-leader-delegate', input.userId);

      const delegationPrompt = buildLeaderDelegationPrompt({
        userQuery: input.userQuery,
        agentNames: input.agentNames,
      });

      // Leader only has chatroom_send in delegation mode
      const chatSendTool: ToolDefinition = {
        type: 'function',
        function: {
          name: 'chatroom_send',
          description: 'Send a delegation, follow-up question, or status message to a team member.',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Delegation or coordination message content' },
              to: {
                description: 'Recipient agent name (e.g. "Benjamin", "Harper", "Lucas") or "All"',
                anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
              contentType: {
                type: 'string',
                enum: ['delegation', 'question', 'status', 'text'],
                description: 'Type of coordination message',
              },
            },
            required: ['message', 'to'],
          },
        },
      };

      const convoHeight: ChatMessage[] = [
        { role: 'system', content: delegationPrompt },
        {
          role: 'user',
          content: `Review your team's initial findings and send targeted follow-up delegation:\n\n${formatTranscriptForLeader(input.chatroomTranscript)}`,
        },
      ];

      const pendingDelegations: ChatroomMessage[] = [];

      trackEvent({
        name: 'SwarmLeaderDelegationStarted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          transcriptLength: input.chatroomTranscript.length,
          agentsHeardFrom: agentsHeardFrom.join(', '),
          swarmId: input.swarmId,
        },
      });

      // Short delegation loop — Leader identifies gaps and delegates (max 3 rounds)
      for (let round = 0; round < 3; round++) {
        const response = await client.chatCompletion({
          messages: convoHeight,
          tools: [chatSendTool],
          toolChoice: 'auto',
          maxTokens: 1024,
          temperature: 0.5,
          correlationId: input.correlationId,
          maxBudgetMs: 15_000,
        });

        const choice = response.choices[0];
        if (!choice) break;

        const assistantMsg = choice.message;
        convoHeight.push(assistantMsg);

        // No tool calls or stop => done delegating
        if (choice.finishReason === 'stop' || !assistantMsg.toolCalls?.length) break;

        for (const tc of assistantMsg.toolCalls) {
          if (tc.function.name === 'chatroom_send') {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const msgContent = String(args['message'] ?? '');
            const to = (args['to'] ?? 'All') as string | string[];
            const contentType = String(args['contentType'] ?? 'delegation');

            const msg: ChatroomMessage = {
              id: crypto.randomUUID(),
              from: input.leaderName,
              to,
              content: msgContent,
              contentType: contentType as ChatroomMessage['contentType'],
              timestamp: Date.now(),
              correlationId: input.swarmCorrelationId,
            };

            const validated = ChatroomMessageSchema.safeParse(msg);
            if (validated.success) {
              pendingDelegations.push(validated.data);
            }

            convoHeight.push({
              role: 'tool',
              content: `Delegation sent to ${typeof to === 'string' ? to : to.join(', ')}`,
              toolCallId: tc.id,
            });
          }
        }
      }

      trackEvent({
        name: 'SwarmLeaderDelegated',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          delegationCount: pendingDelegations.length,
          agentsTargeted: [
            ...new Set(pendingDelegations.map(m =>
              typeof m.to === 'string' ? m.to : m.to.join(','),
            )),
          ].join(', '),
          swarmId: input.swarmId,
        },
      });

      return {
        synthesis: '',
        success: true,
        tokensUsed: 0,
        roundsUsed: 1,
        agentsHeardFrom,
        model: routing.lane.primary,
        _pendingChatroomMessages: pendingDelegations,
      };
    }

    // -----------------------------------------------------------------------
    // Synthesis mode (standard): Leader produces the final polished answer.
    // -----------------------------------------------------------------------
    await recordOrchestratorStage(input.correlationId, 'swarm-leader', input.userId);

    const systemPrompt = buildLeaderSystemPrompt({
      userQuery: input.userQuery,
      synthesisInstructions: input.synthesisInstructions,
      agentNames: input.agentNames,
    });

    const transcript = formatTranscriptForLeader(input.chatroomTranscript);

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
