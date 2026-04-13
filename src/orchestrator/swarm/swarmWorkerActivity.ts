// Swarm Worker Activity — runs a single agent in a multi-turn tool loop.
// Each worker: drain chatroom → build context → LLM call → dispatch tools → chatroom_send → repeat.
// Spec ref: docs/0ze §4.4, docs/0zf §3
// Epic: #631

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../../llm/foundryClient.js';
import { getModelRouting } from '../../llm/modelRouter.js';
import { toolRegistry } from '../../tools/toolRegistry.js';
import { getHandler } from '../../capabilities/capabilityLoader.js';
import { trackEvent } from '../../observability/telemetry.js';
import { recordOrchestratorStage } from '../../observability/orchestratorStageHealth.js';
import { buildWorkerSystemPrompt } from './swarmPersonas.js';
import type { ChatMessage, ToolDefinition } from '../../llm/foundryClient.js';
import type { ChatroomMessage, SwarmWorkerInput, SwarmWorkerResult } from './swarmTypes.js';
import { ChatroomMessageSchema } from './swarmTypes.js';

// Internal "virtual tool" name — intercepted by the worker, not dispatched
const CHATROOM_SEND_TOOL = 'chatroom_send';

// Auto-injected memory search tool — always available to all swarm agents (#633)
const CONVERSATION_SEARCH_TOOL = 'conversation_search';

/**
 * Build the tool definitions array for a worker agent.
 * Includes only assigned tools + chatroom_send (virtual) + conversation_search (auto).
 */
function buildWorkerToolSchemas(assignedToolNames: string[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Add assigned external tools (deduplicate conversation_search if already assigned)
  const seenNames = new Set<string>();
  for (const name of assignedToolNames) {
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    const def = toolRegistry.get(name);
    if (def) {
      tools.push({
        type: 'function',
        function: {
          name: def.name,
          description: def.description,
          parameters: (def.inputSchema ?? {}) as Record<string, unknown>,
        },
      });
    }
  }

  // Add conversation_search from registry if not already present
  if (!seenNames.has(CONVERSATION_SEARCH_TOOL)) {
    const searchDef = toolRegistry.get(CONVERSATION_SEARCH_TOOL);
    if (searchDef) {
      tools.push({
        type: 'function',
        function: {
          name: searchDef.name,
          description: searchDef.description,
          parameters: (searchDef.inputSchema ?? {}) as Record<string, unknown>,
        },
      });
    }
  }

  // Add the virtual chatroom_send tool
  tools.push({
    type: 'function',
    function: {
      name: CHATROOM_SEND_TOOL,
      description: 'Send a message to other agents in your team. Messages appear in their context on the next turn.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message content (partial results, questions, status updates, etc.)',
          },
          to: {
            description: 'Recipient: agent name (e.g. "Leader", "Alpha") or "All" for broadcast',
            anyOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          contentType: {
            type: 'string',
            enum: ['text', 'partial_result', 'cross_verification', 'question', 'status', 'error'],
            description: 'Type of message (default: text)',
          },
        },
        required: ['message', 'to'],
      },
    },
  });

  return tools;
}

/**
 * Execute a single tool call and return the result string.
 */
async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  correlationId: string,
): Promise<string> {
  // Safety check
  if (!toolRegistry.isAllowedBySafetyMode(toolName)) {
    trackEvent({
      name: 'SwarmToolBlocked',
      correlationId,
      properties: { toolName, reason: 'safety_mode' },
    });
    return `Tool ${toolName} blocked by safety mode`;
  }

  const handler = getHandler(toolName);
  if (!handler) {
    trackEvent({
      name: 'SwarmToolHandlerMissing',
      correlationId,
      properties: { toolName },
    });
    return `No handler for tool: ${toolName}`;
  }

  try {
    args['userId'] = userId;
    args['correlationId'] = correlationId;
    const result = await handler(args);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    trackEvent({
      name: 'SwarmToolError',
      correlationId,
      properties: { toolName, error: msg.slice(0, 300) },
    });
    return `Tool error: ${msg}`;
  }
}

// ---------------------------------------------------------------------------
// Durable Activity
// ---------------------------------------------------------------------------

df.app.activity('swarmWorkerActivity', {
  handler: async (input: SwarmWorkerInput): Promise<SwarmWorkerResult> => {
    // Update stage tracking so the health endpoint shows swarm progress
    await recordOrchestratorStage(input.correlationId, 'swarm-workers', input.userId);

    const routing = getModelRouting();
    // All swarm agents use the primary (high-capacity) model — confirmed by Grok team
    const client = new FoundryClient({
      ...routing,
      deploymentName: routing.lane.primary,
      isReasoning: routing.lane.primary.includes('reasoning') || routing.lane.primary.startsWith('o'),
    });

    const tools = buildWorkerToolSchemas(input.assignedTools);
    const allAgentNames = [input.agentName]; // Extended by orchestrator context
    const systemPrompt = buildWorkerSystemPrompt({
      agentName: input.agentName,
      agentRole: input.agentRole,
      task: input.task,
      assignedToolNames: input.assignedTools,
      allAgentNames,
      userQuery: input.userQuery,
    });

    // Conversation history for this agent's isolated session
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Execute your task now. Your assignment: ${input.task}` },
    ];

    let totalTokens = 0;
    let toolCallsMade = 0;
    let chatroomMessagesSent = 0;

    // The entity client must be constructed from the entity ID string.
    // In the activity, we use a raw HTTP approach or the Durable client from the context.
    // Since activities don't have ctx.df for entity calls, the chatroom messages
    // are collected and returned to the orchestrator for entity signaling.
    const pendingChatroomMessages: ChatroomMessage[] = [];

    trackEvent({
      name: 'SwarmWorkerStarted',
      correlationId: input.correlationId,
      userId: input.userId,
      properties: {
        agentName: input.agentName,
        agentRole: input.agentRole,
        assignedTools: input.assignedTools.join(', '),
        swarmId: input.swarmId,
      },
    });

    try {
      for (let round = 0; round < input.maxRounds; round++) {
        // LLM inference call — atomic, no mid-stream injection
        const response = await client.chatCompletion({
          messages,
          tools: tools.length > 0 ? tools : undefined,
          toolChoice: tools.length > 0 ? 'auto' : undefined,
          maxTokens: 2048,
          temperature: 0.7,
          correlationId: input.correlationId,
          maxBudgetMs: 20_000,
        });

        totalTokens += response.usage?.totalTokens ?? 0;
        const choice = response.choices[0];
        if (!choice) break;

        const assistantMessage = choice.message;
        messages.push(assistantMessage);

        // If the model produced text content without tool calls, agent is done
        if (choice.finishReason === 'stop' || !assistantMessage.toolCalls?.length) {
          // If there's final text, send it to Leader as a final status
          const finalText = textContent(assistantMessage.content);
          if (finalText.trim()) {
            pendingChatroomMessages.push({
              id: crypto.randomUUID(),
              from: input.agentName,
              to: 'Leader',
              content: finalText.trim(),
              contentType: 'partial_result',
              timestamp: Date.now(),
              correlationId: input.swarmCorrelationId,
            });
            chatroomMessagesSent++;
          }
          break;
        }

        // Process tool calls
        for (const tc of assistantMessage.toolCalls) {
          const parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;

          if (tc.function.name === CHATROOM_SEND_TOOL) {
            // Virtual tool — create chatroom message
            const msgContent = String(parsedArgs['message'] ?? '');
            const to = (parsedArgs['to'] ?? 'Leader') as string | string[];
            const contentType = String(parsedArgs['contentType'] ?? 'text');

            const chatroomMsg: ChatroomMessage = {
              id: crypto.randomUUID(),
              from: input.agentName,
              to,
              content: msgContent,
              contentType: contentType as ChatroomMessage['contentType'],
              timestamp: Date.now(),
              correlationId: input.swarmCorrelationId,
            };

            // Validate
            const validated = ChatroomMessageSchema.safeParse(chatroomMsg);
            if (validated.success) {
              pendingChatroomMessages.push(validated.data);
              chatroomMessagesSent++;
            }

            // Tool response back to LLM
            messages.push({
              role: 'tool',
              content: `Message sent to ${typeof to === 'string' ? to : to.join(', ')}`,
              toolCallId: tc.id,
            });
          } else if (input.assignedTools.includes(tc.function.name)) {
            // External tool — execute it
            toolCallsMade++;
            const result = await executeToolCall(
              tc.function.name,
              parsedArgs,
              input.userId,
              input.correlationId,
            );

            messages.push({
              role: 'tool',
              content: result,
              toolCallId: tc.id,
            });
          } else {
            // Tool not in agent's allowed list
            messages.push({
              role: 'tool',
              content: `Error: Tool "${tc.function.name}" is not in your assigned tool list. Use only: ${input.assignedTools.join(', ')}`,
              toolCallId: tc.id,
            });
          }
        }
      }

      trackEvent({
        name: 'SwarmWorkerCompleted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: {
          agentName: input.agentName,
          roundsUsed: Math.min(messages.filter(m => m.role === 'assistant').length, input.maxRounds),
          toolCallsMade,
          chatroomMessagesSent,
          tokensUsed: totalTokens,
        },
      });

      return {
        agentName: input.agentName,
        success: true,
        roundsUsed: messages.filter(m => m.role === 'assistant').length,
        tokensUsed: totalTokens,
        toolCallsMade,
        chatroomMessagesSent,
        model: routing.lane.primary,
        // Pass pending chatroom messages back — the orchestrator will signal the entity
        _pendingChatroomMessages: pendingChatroomMessages,
      } as SwarmWorkerResult & { _pendingChatroomMessages: ChatroomMessage[] };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      trackEvent({
        name: 'SwarmWorkerError',
        correlationId: input.correlationId,
        properties: { agentName: input.agentName, error: errorMessage },
      });
      return {
        agentName: input.agentName,
        success: false,
        roundsUsed: messages.filter(m => m.role === 'assistant').length,
        tokensUsed: totalTokens,
        toolCallsMade,
        chatroomMessagesSent,
        error: errorMessage,
        model: routing.lane.primary,
      };
    }
  },
});
