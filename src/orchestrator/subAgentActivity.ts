// Sub-agent activity — runs a tool call in an isolated LLM session.
// No shared conversation history; uses secondary model; minimal context.
// The LLM decides how to invoke the tool, then the handler executes it.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 0b-Model-Specific-Tool-Presentation.md

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../llm/foundryClient.js';
import { getModelRouting, getModelForTask } from '../llm/modelRouter.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { getHandler } from '../capabilities/capabilityLoader.js';
import { trackEvent } from '../observability/telemetry.js';
import type { ChatMessage } from '../llm/foundryClient.js';
import { MemoryManager } from '../memory/memoryManager.js';

export interface SubAgentInput {
  toolName: string;
  toolDescription: string;
  toolInputSchema?: Record<string, unknown>;
  arguments: Record<string, unknown>;
  userContext: string;
  correlationId: string;
  sessionId: string;
  userId: string;
}

export interface SubAgentResult {
  success: boolean;
  model: string;
  output: unknown;
  error?: string;
  tokensUsed: number;
  correlationId: string;
}

df.app.activity('subAgentActivity', {
  handler: async (input: SubAgentInput): Promise<SubAgentResult> => {
    // Create a client using the secondary (fast) model — fresh routing, no shared state
    const baseRouting = getModelRouting();
    const secondaryModel = getModelForTask('fast');
    const client = new FoundryClient({
      ...baseRouting,
      deploymentName: secondaryModel,
      isReasoning: false,
    });

    const tool = toolRegistry.get(input.toolName);

    // Build minimal context — ONLY what the sub-agent needs for this one tool
    const systemPrompt = `You are a tool-use sub-agent. You have exactly one task: call the provided tool.
Do NOT call any other tools. Do NOT attempt recursive tool calling.
Return only the tool result.

Tool: ${input.toolName}
Description: ${input.toolDescription}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Execute tool "${input.toolName}" with arguments: ${JSON.stringify(input.arguments)}`,
      },
    ];

    // Only expose the single requested tool — prevents recursive calls
    const tools = tool
      ? [
          {
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
            },
          },
        ]
      : [];

    let tokensUsed = 0;

    try {
      const response = await client.chatCompletion({
        messages,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: tools.length > 0 ? 'auto' : undefined,
        maxTokens: 1024,
        temperature: 0.1,
        correlationId: input.correlationId,
      });

      tokensUsed = response.usage.totalTokens;
      const choice = response.choices[0];

      if (choice.finishReason === 'tool_calls' && choice.message.toolCalls?.length) {
        // Sub-agent decided to call the tool — now actually execute the handler
        const tc = choice.message.toolCalls[0];
        const handler = getHandler(tc.function.name);

        if (!handler) {
          return {
            success: false,
            model: secondaryModel,
            output: null,
            error: `No handler registered for tool: ${tc.function.name}`,
            tokensUsed,
            correlationId: input.correlationId,
          };
        }

        const parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        parsedArgs['userId'] = input.userId;
        const handlerResult = await handler(parsedArgs);

        trackEvent({
          name: 'SubAgentToolExecuted',
          correlationId: input.correlationId,
          userId: input.userId,
          properties: { toolName: tc.function.name, success: true, model: secondaryModel },
        });

        // Store sub-agent result as skill memory for JIT injection (#203)
        // Mirrors toolDispatchActivity to prevent cross-turn context loss.
        if (tool?.handlerModule) {
          const skillId = tool.handlerModule.replace('skills/', '');
          const mm = new MemoryManager(input.userId);
          mm.storeToolResult(skillId, tc.function.name, JSON.stringify(handlerResult)).catch(() => { /* non-fatal */ });
        }

        return {
          success: true,
          model: secondaryModel,
          output: handlerResult,
          tokensUsed,
          correlationId: input.correlationId,
        };
      }

      // Sub-agent returned text instead of tool call — parse if possible
      const text = textContent(choice.message.content);
      let output: unknown;
      try {
        output = JSON.parse(text);
      } catch {
        output = { text };
      }

      return {
        success: true,
        model: secondaryModel,
        output,
        tokensUsed,
        correlationId: input.correlationId,
      };
    } catch (err) {
      trackEvent({
        name: 'SubAgentToolExecuted',
        correlationId: input.correlationId,
        userId: input.userId,
        properties: { toolName: input.toolName, success: false, error: err instanceof Error ? err.message : String(err) },
      });

      return {
        success: false,
        model: secondaryModel,
        output: null,
        error: err instanceof Error ? err.message : String(err),
        tokensUsed,
        correlationId: input.correlationId,
      };
    }
  },
});
