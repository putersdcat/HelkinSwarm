// Swarm Worker Activity — runs a single agent in a multi-turn tool loop.
// Each worker: drain chatroom → build context → LLM call → dispatch tools → chatroom_send → repeat.
// Spec ref: docs/0ze §4.4, docs/0zf §3
// Epic: #631

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../../llm/foundryClient.js';
import { getModelRouting, isReasoningModel } from '../../llm/modelRouter.js';
import { toolRegistry } from '../../tools/toolRegistry.js';
import { getHandler } from '../../capabilities/capabilityLoader.js';
import { trackEvent } from '../../observability/telemetry.js';
import { recordOrchestratorStage } from '../../observability/orchestratorStageHealth.js';
import { buildWorkerSystemPrompt, stripRenderTags } from './swarmPersonas.js';
import { resolveSwarmUserInfo } from './swarmUserInfo.js';
import { parseChatroomSendMessage, stripSelfEchoRecipients } from './chatroomEnvelope.js';
import { scopedTokenMinter } from '../../auth/scopedTokenMinter.js';
import { mapPrivilegeClassToScopedTokenScope } from '../../auth/tokenScopeMapping.js';
import { MemoryManager } from '../../memory/memoryManager.js';
import type { ChatMessage, ToolDefinition } from '../../llm/foundryClient.js';
import type { ChatroomMessage, SwarmWorkerInput, SwarmWorkerResult } from './swarmTypes.js';
import { ChatroomMessageSchema } from './swarmTypes.js';

// Internal "virtual tool" name — intercepted by the worker, not dispatched
const CHATROOM_SEND_TOOL = 'chatroom_send';

// Yield/resume synchronization primitive — intercepted when agent calls swarm_wait (#646)
const SWARM_WAIT_TOOL = 'swarm_wait';

// Auto-injected memory search tool — always available to all swarm agents (#633)
const CONVERSATION_SEARCH_TOOL = 'conversation_search';

/**
 * Build the initial user turn, optionally prefixed with inbound teammate messages (#644 Slice 1).
 * Inbound messages are injected when this is a second-pass refinement activity.
 * Exported for unit testing.
 */
export function buildInitialUserTurn(task: string, inboundMessages?: ChatroomMessage[]): string {
  const base = `Execute your task now. Your assignment: ${task}`;
  if (!inboundMessages?.length) return base;
  // Strip leader-only Render Components from any inbound content (#672).
  // Workers must never see <render_*> tags in internal chatroom traffic.
  const teamContext = inboundMessages
    .map(m => `**From ${m.from}** (to ${typeof m.to === 'string' ? m.to : m.to.join(', ')}): ${stripRenderTags(m.content)}`)
    .join('\n\n');
  return `${base}\n\n[TEAM MESSAGES — RECEIVED FROM TEAMMATES]\n${teamContext}\n[END TEAM MESSAGES]\n\nReview these teammate messages and send any additional insights or corrections to Helkin.`;
}

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
      description: 'Send a message to other agents in your team. The `message` parameter MUST be a JSON string matching the canonical envelope: {"messageType": "thinking"|"tool_summary"|"analysis"|"response"|"question"|"contribution"|"final_contribution", "content": "...", "confidence": 0-100, "sender": "<YourName>"}. Messages are delivered to the recipient on their next turn.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Canonical JSON envelope (see tool description). Legacy plain-text messages are still accepted for backwards compatibility but should not be used.',
          },
          to: {
            description: 'Recipient: agent name (e.g. "Helkin", "Benjamin", "Harper", "Lucas") or "All" for broadcast. Never list yourself — the orchestrator strips self-echo recipients.',
            anyOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          contentType: {
            type: 'string',
            enum: ['text', 'partial_result', 'cross_verification', 'question', 'status', 'error'],
            description: 'Transport-layer type (default: text). Orthogonal to the canonical messageType inside the payload.',
          },
        },
        required: ['message', 'to'],
      },
    },
  });

  // Add the virtual swarm_wait tool — yields agent until peer messages arrive (#646)
  tools.push({
    type: 'function',
    function: {
      name: SWARM_WAIT_TOOL,
      description: 'Pause your execution and wait for a specific teammate to send their results. Their messages will be injected into your context before you continue working.',
      parameters: {
        type: 'object',
        properties: {
          waitFor: {
            description: 'Agent name(s) to wait for (e.g. "Benjamin", ["Benjamin", "Harper"]) or "Any" for the next available peer message',
            anyOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          reason: {
            type: 'string',
            description: 'Brief reason for waiting (e.g. "need pricing data before I can rank options")',
          },
        },
        required: ['waitFor'],
      },
    },
  });

  return tools;
}

/**
 * Execute a single tool call and return the result string.
 * Mirrors toolDispatchActivity's security surface (#656/#662):
 *   - blocks requiresExecutor tools (workers cannot surface confirmation cards)
 *   - mints least-privilege scoped tokens for every tool that has a scope mapping
 */
async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  correlationId: string,
): Promise<string> {
  // Safety mode check
  if (!toolRegistry.isAllowedBySafetyMode(toolName)) {
    trackEvent({
      name: 'SwarmToolBlocked',
      correlationId,
      properties: { toolName, reason: 'safety_mode' },
    });
    return `Tool ${toolName} blocked by safety mode`;
  }

  const toolDef = toolRegistry.get(toolName);

  // Block tools that require executor approval — workers cannot surface confirmation cards.
  // Only Helkin (the conscious orchestrator) can gate on executor approval (#656 §6).
  if (toolDef?.requiresExecutor) {
    trackEvent({
      name: 'SwarmToolBlocked',
      correlationId,
      properties: { toolName, reason: 'requires_executor' },
    });
    return `Tool ${toolName} requires Helkin approval and cannot be used directly by swarm workers`;
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

    // Mint least-privilege scoped token — same pattern as toolDispatchActivity (#317, #662).
    // Non-fatal: if minting fails the handler falls back to legacy token acquisition.
    if (toolDef) {
      const tokenScope = mapPrivilegeClassToScopedTokenScope(toolDef.privilegeClass);
      if (tokenScope) {
        try {
          const domain = toolDef.handlerModule?.replace('skills/', '') ?? 'core';
          const scopedToken = await scopedTokenMinter.mint({
            toolName,
            scope: tokenScope,
            targetResource: domain,
            userId,
            correlationId,
          });
          args['_scopedToken'] = scopedToken.token;
          args['_scopedTokenScope'] = scopedToken.scope;
          args['_scopedTokenMethod'] = scopedToken.method;
        } catch {
          // Non-fatal — handler falls back to legacy token acquisition
        }
      }
    }

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
    // Per-agent model specialization: use modelOverride if provided, else primary (#648).
    // #685 — cross-model swarm is not yet safe: Lucas has no minimax-specific persona,
    // so routing him to minimax-m2.7 produces raw JSON envelopes and degraded tool-calling
    // behaviour. Gated behind SWARM_MODEL_OVERRIDE_ENABLED=true (default off) until a
    // proper per-model persona ships. When gated off, any modelOverride is ignored and a
    // ModelOverrideIgnored telemetry event is emitted for observability.
    const modelOverrideEnabled = process.env.SWARM_MODEL_OVERRIDE_ENABLED === 'true';
    const requestedOverride = input.modelOverride;
    if (requestedOverride && !modelOverrideEnabled) {
      trackEvent({
        name: 'ModelOverrideIgnored',
        correlationId: input.correlationId,
        properties: {
          agentName: input.agentName,
          requestedModel: requestedOverride,
          appliedModel: routing.lane.primary,
          reason: 'SWARM_MODEL_OVERRIDE_ENABLED not set',
        },
      });
    }
    const agentDeploymentName = (modelOverrideEnabled && requestedOverride) ? requestedOverride : routing.lane.primary;
    const client = new FoundryClient({
      ...routing,
      deploymentName: agentDeploymentName,
      isReasoning: isReasoningModel(agentDeploymentName),
    });

    const tools = buildWorkerToolSchemas(input.assignedTools);
    const allAgentNames = input.allAgentNames ?? [input.agentName];

    // Load prior session context for this agent from Cosmos sessions container (#659).
    // Non-fatal: if Cosmos is unavailable, agent runs without prior context.
    const sessionMm = new MemoryManager(input.userId);
    const agentMm = new MemoryManager(input.userId, input.agentName);
    const priorSessions = await sessionMm.loadRecentAgentSessions(input.agentName).catch(() => [] as string[]);

    // Semantic RAG recall from this agent's vault (#663 — per-agent RAG memory).
    // Finds relevant prior findings from this exact agent's vault based on the current task.
    // Injected alongside session summaries so the agent can avoid repeating known work.
    const priorKnowledge = await agentMm.recall(input.task, {
      topK: 3,
      minScore: 0.7,
    }).catch(() => [] as { content: string; score: number; skillId?: string; tags: string[]; createdAt: string }[]);

    // Merge: session summaries (recency) + semantic recall (task-relevance)
    const allPriorContext: string[] = [
      ...priorSessions,
      ...priorKnowledge.map(r =>
        `[relevant prior finding] ${r.content.slice(0, 200)}`),
    ];

    const systemPrompt = buildWorkerSystemPrompt({
      agentName: input.agentName,
      agentRole: input.agentRole,
      task: input.task,
      assignedToolNames: input.assignedTools,
      allAgentNames,
      userQuery: input.userQuery,
      agentPersona: input.agentPersona,
      personaFile: input.personaFile,
      priorSessionSummaries: allPriorContext.length > 0 ? allPriorContext : undefined,
      userInfo: input.userInfo ?? await resolveSwarmUserInfo(input.userId).catch(() => undefined),
      nowISO: new Date().toISOString(),
    });

    // Conversation history for this agent's isolated session
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: buildInitialUserTurn(input.task, input.inboundMessages),
      },
    ];

    let totalTokens = 0;
    let totalCost = 0;
    let toolCallsMade = 0;
    let chatroomMessagesSent = 0;
    let tokenBudgetExceeded = false;
    // swarm_wait state — set when the agent explicitly yields for peer messages (#646)
    let requestsSecondPass = false;
    let waitingFor: string[] = [];
    const toolsUsedSet = new Set<string>();
    const startTimeMs = Date.now();

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
        // LLM inference call — atomic, no mid-stream injection.
        // onToken enables SSE streaming mode (#637 Phase 1): each token delta is
        // observed by the callback, which count tokens in real-time for debugging.
        // The callback fires after all bytes arrive (post-hoc, not real-time
        // delivery) — Phase 2 will add progressive user-facing streaming.
        let streamedTokenCount = 0;
        const onToken = (_text: string) => { streamedTokenCount++; };

        // Budget must be large enough to allow a real primary-then-fallback
        // cascade on the FoundryClient chain. The non-reasoning baseTimeout is
        // 55_000ms and MIN_PER_MODEL_TIMEOUT_MS is 8_000ms, so the minimum
        // budget that can actually trigger a cascade is 55_000 + 8_000 = 63_000ms.
        // Anything below that lets a single primary-model timeout consume the
        // whole budget and the chain exits before even trying the fallback,
        // manifesting as the Harper/Lucas "All models in fallback chain
        // exhausted" repro (corr 3e3b0ecd on 2026-04-21 with 20_000ms;
        // corr 9a0f9f82 on 2026-04-21 with 50_000ms — still exhausted because
        // 50_000 < 63_000). 90_000ms gives primary ~55s and fallback ~35s.
        const response = await client.chatCompletion({
          messages,
          tools: tools.length > 0 ? tools : undefined,
          toolChoice: tools.length > 0 ? 'auto' : undefined,
          maxTokens: 2048,
          temperature: 0.7,
          correlationId: input.correlationId,
          maxBudgetMs: 90_000,
          onToken,
        });

        totalTokens += response.usage?.totalTokens ?? 0;
        if (response.usage?.providerCost != null) {
          totalCost += response.usage.providerCost;
        }

        // Emit streaming observability event when tokens were streamed (#637 Phase 1)
        if (streamedTokenCount > 0) {
          trackEvent({
            name: 'SwarmWorkerStreamingComplete',
            correlationId: input.correlationId,
            userId: input.userId,
            properties: {
              agentName: input.agentName,
              round: String(round),
              streamedTokenCount: String(streamedTokenCount),
              reportedTotalTokens: String(response.usage?.totalTokens ?? 0),
            },
          });
        }

        const choice = response.choices[0];
        if (!choice) break;

        // Token budget enforcement (#647) — stop agent if it exceeded allocation
        if (input.tokenBudget && totalTokens >= input.tokenBudget) {
          tokenBudgetExceeded = true;
          trackEvent({
            name: 'SwarmWorkerBudgetExceeded',
            correlationId: input.correlationId,
            userId: input.userId,
            properties: {
              agentName: input.agentName,
              tokenBudget: input.tokenBudget,
              tokensUsed: totalTokens,
              roundsUsed: round + 1,
            },
          });
          // Still process this response's content, but break after
          const budgetText = textContent(choice.message.content);
          if (budgetText.trim()) {
            pendingChatroomMessages.push({
              id: crypto.randomUUID(),
              from: input.agentName,
              to: 'Leader',
              content: budgetText.trim(),
              contentType: 'partial_result',
              timestamp: Date.now(),
              correlationId: input.swarmCorrelationId,
            });
            chatroomMessagesSent++;
          }
          break;
        }

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
          let parsedArgs: Record<string, unknown>;
          try {
            parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            // Malformed tool arguments from LLM — skip this call and return error to model
            messages.push({
              role: 'tool',
              content: 'Error: malformed tool arguments (not valid JSON)',
              toolCallId: tc.id,
            });
            continue;
          }

          if (tc.function.name === CHATROOM_SEND_TOOL) {
            // Canonical chatroom_send wire contract (#673). Parse the JSON envelope
            // in the `message` field; fall back to legacy freeform on malformed input.
            const rawMessage = String(parsedArgs['message'] ?? '');
            const rawTo = (parsedArgs['to'] ?? 'Helkin') as string | string[];
            const contentType = String(parsedArgs['contentType'] ?? 'text');
            const parsedEnvelope = parseChatroomSendMessage(rawMessage, input.agentName);

            // Echo guard: sender must never appear in its own recipient list.
            const to = stripSelfEchoRecipients(input.agentName, rawTo);

            const chatroomMsg: ChatroomMessage = {
              id: crypto.randomUUID(),
              from: input.agentName,
              to,
              content: parsedEnvelope.displayContent,
              contentType: contentType as ChatroomMessage['contentType'],
              timestamp: Date.now(),
              correlationId: input.swarmCorrelationId,
              messageType: parsedEnvelope.payload?.messageType,
              confidence: parsedEnvelope.payload?.confidence,
              sender: parsedEnvelope.payload?.sender ?? input.agentName,
            };

            // Validate
            const validated = ChatroomMessageSchema.safeParse(chatroomMsg);
            if (validated.success) {
              pendingChatroomMessages.push(validated.data);
              chatroomMessagesSent++;
            }

            // Structured telemetry: surface parsed messageType + confidence for
            // downstream observability. Legacy freeform messages still land with
            // legacy=true so gaps are visible.
            trackEvent({
              name: 'SwarmChatroomSend',
              correlationId: input.correlationId,
              userId: input.userId,
              properties: {
                from: input.agentName,
                to: Array.isArray(to) ? to.join(',') : to,
                contentType,
                messageType: parsedEnvelope.payload?.messageType ?? '',
                confidence: parsedEnvelope.payload?.confidence ?? -1,
                legacy: parsedEnvelope.legacy,
                swarmId: input.swarmId,
              },
            });

            // Route to target agent's Cosmos session chain (#661).
            // The recipient loads this message via loadRecentAgentSessions on their next activation.
            // Only route to named worker agents (not "Helkin", "Leader", "All").
            const EXCLUDED_TARGETS = new Set(['helkin', 'leader', 'all']);
            const recipients = Array.isArray(to) ? to : [to];
            for (const recipient of recipients) {
              if (
                !EXCLUDED_TARGETS.has(recipient.toLowerCase()) &&
                // echo guard again at routing layer for safety
                recipient.toLowerCase() !== input.agentName.toLowerCase()
              ) {
                await sessionMm.storeAgentSessionSummary(
                  recipient,
                  `[Chatroom from ${input.agentName} | ${new Date().toISOString()}] ${parsedEnvelope.displayContent.slice(0, 300)}`,
                ).catch(() => { /* non-fatal */ });
              }
            }

            // Tool response back to LLM
            messages.push({
              role: 'tool',
              content: `Message sent to ${typeof to === 'string' ? to : to.join(', ')}`,
              toolCallId: tc.id,
            });
          } else if (tc.function.name === SWARM_WAIT_TOOL) {
            // swarm_wait — agent yields; orchestrator guarantees second pass with peer messages (#646)
            const waitArgs = parsedArgs as { waitFor?: string | string[]; reason?: string };
            const raw = waitArgs.waitFor ?? 'Any';
            waitingFor = Array.isArray(raw) ? raw : [raw];
            requestsSecondPass = true;

            trackEvent({
              name: 'SwarmWorkerWaitRequested',
              correlationId: input.correlationId,
              userId: input.userId,
              properties: {
                agentName: input.agentName,
                waitingFor: waitingFor.join(', '),
                reason: String(waitArgs.reason ?? ''),
                swarmId: input.swarmId,
              },
            });

            messages.push({
              role: 'tool',
              content: `Wait registered. Pausing execution. You will resume with messages from ${waitingFor.join(', ')} injected into your context.`,
              toolCallId: tc.id,
            });

            // swarm_wait terminates the current round — break out of the tool-call loop
            break;
          } else if (input.assignedTools.includes(tc.function.name) || tc.function.name === CONVERSATION_SEARCH_TOOL) {
            // Gate elevated tools — cannot run directly in swarm worker context (#638 Slice 1)
            const toolDef = toolRegistry.get(tc.function.name);
            if (toolDef?.requiresSubAgent) {
              trackEvent({
                name: 'SwarmSubSessionRequested',
                correlationId: input.correlationId,
                userId: input.userId,
                properties: {
                  agentName: input.agentName,
                  toolName: tc.function.name,
                  swarmId: input.swarmId,
                },
              });

              // Package a sub_session_request for orchestrator interception (#638 Slice 2)
              const subSessionMsg: ChatroomMessage = {
                id: crypto.randomUUID(),
                from: input.agentName,
                to: 'Leader',
                content: JSON.stringify({
                  toolName: tc.function.name,
                  toolArgs: parsedArgs,
                  requestingAgent: input.agentName,
                }),
                contentType: 'sub_session_request',
                timestamp: Date.now(),
                correlationId: input.swarmCorrelationId,
              };
              const validatedSubSession = ChatroomMessageSchema.safeParse(subSessionMsg);
              if (validatedSubSession.success) {
                pendingChatroomMessages.push(validatedSubSession.data);
                chatroomMessagesSent++;
              }

              messages.push({
                role: 'tool',
                content: `Tool "${tc.function.name}" requires elevated permission. A sub-session request has been routed to the orchestrator — result will be injected into your context when ready. Continue with other tasks while waiting.`,
                toolCallId: tc.id,
              });
            } else {
              // Non-elevated external tool — execute directly
              toolCallsMade++;
              toolsUsedSet.add(tc.function.name);
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
            }
          } else {
            // Tool not in agent's allowed list
            messages.push({
              role: 'tool',
              content: `Error: Tool "${tc.function.name}" is not in your assigned tool list. Use only: ${input.assignedTools.join(', ')}`,
              toolCallId: tc.id,
            });
          }
        }
        // If swarm_wait was called in this round, exit the round loop immediately
        if (requestsSecondPass) break;
      }

      // Persist a rolling session summary for this agent's Cosmos session chain (#659).
      // Gives the agent prior-turn context on its next activation.
      // Non-fatal: if Cosmos write fails, the swarm result is unaffected.
      const keyFindings = pendingChatroomMessages
        .filter(m => m.contentType === 'partial_result')
        .map(m => m.content.slice(0, 80))
        .slice(0, 3)
        .join('; ');
      const sessionSummary =
        `Swarm ${input.swarmId.slice(-8)} | Query: ${input.userQuery.slice(0, 80)} | ` +
        `Task: ${input.task.slice(0, 80)} | Tools: ${[...toolsUsedSet].join(', ')} | ` +
        `Rounds: ${messages.filter(m => m.role === 'assistant').length} | ` +
        `Findings: ${keyFindings || 'sent to chatroom'}`;
      await sessionMm.storeAgentSessionSummary(input.agentName, sessionSummary).catch(() => { /* non-fatal */ });

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
          toolsUsed: [...toolsUsedSet].join(', '),
          durationMs: Date.now() - startTimeMs,
          ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
          tokenBudgetExceeded,
        },
      });

      return {
        agentName: input.agentName,
        success: true,
        roundsUsed: messages.filter(m => m.role === 'assistant').length,
        tokensUsed: totalTokens,
        toolCallsMade,
        chatroomMessagesSent,
        toolsUsed: [...toolsUsedSet],
        durationMs: Date.now() - startTimeMs,
        model: agentDeploymentName,
        tokenBudget: input.tokenBudget,
        tokenBudgetExceeded,
        cost: totalCost,
        // Pass pending chatroom messages back — orchestrator signals the entity
        _pendingChatroomMessages: pendingChatroomMessages,
        // swarm_wait state — orchestrator uses these to guarantee a second pass (#646)
        _requestsSecondPass: requestsSecondPass,
        ...(waitingFor.length > 0 ? { _waitingFor: waitingFor } : {}),
      } as SwarmWorkerResult & { _pendingChatroomMessages: ChatroomMessage[]; _requestsSecondPass: boolean; _waitingFor?: string[] };
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
        toolsUsed: [...toolsUsedSet],
        durationMs: Date.now() - startTimeMs,
        error: errorMessage,
        model: agentDeploymentName,
        tokenBudget: input.tokenBudget,
        tokenBudgetExceeded,
        cost: totalCost,
      };
    }
  },
});
