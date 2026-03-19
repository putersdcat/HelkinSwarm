// Sub-agent activity — runs a tool call in an isolated LLM session.
// No shared conversation history; uses secondary model; minimal context.
// Spec ref: 06-Tool-Dispatch-LLM-Layer.md, 0b-Model-Specific-Tool-Presentation.md

import * as df from 'durable-functions';
import { createFoundryClient } from '../llm/foundryClient.js';
import { getModelForTask } from '../llm/modelRouter.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import type { ChatMessage } from '../llm/foundryClient.js';

export interface SubAgentInput {
  toolName: string;
  toolDescription: string;
  toolInputSchema?: Record<string, unknown>;
  arguments: Record<string, unknown>;
  userContext: string;
  correlationId: string;
  sessionId: string;
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
    const client = createFoundryClient();
    const tool = toolRegistry.get(input.toolName);
    const model = getModelForTask('fast');

    // Build minimal context message for the sub-agent
    const systemPrompt = `You are a tool-use sub-agent. You have one task: use the provided tool with the given arguments.
Do NOT call any other tools. Return only the tool result as a JSON object.
Tool: ${input.toolName}
Description: ${input.toolDescription}
Arguments: ${JSON.stringify(input.arguments, null, 2)}

User context: ${input.userContext}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Execute tool "${input.toolName}" with these arguments: ${JSON.stringify(input.arguments)}`,
      },
    ];

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

    try {
      const response = await client.chatCompletion({
        messages,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: tools.length > 0 ? 'auto' : undefined,
        maxTokens: 1024,
        temperature: 0.1,
        correlationId: input.correlationId,
      });

      const choice = response.choices[0];
      let output: unknown = null;

      if (choice.finishReason === 'tool_calls' && choice.message.toolCalls) {
        // Sub-agent called the tool — extract result
        output = { toolCalls: choice.message.toolCalls };
      } else {
        // Sub-agent returned text — parse if possible
        try {
          output = JSON.parse(choice.message.content);
        } catch {
          output = { text: choice.message.content };
        }
      }

      return {
        success: true,
        model: response.model,
        output,
        tokensUsed: response.usage.totalTokens,
        correlationId: input.correlationId,
      };
    } catch (err) {
      return {
        success: false,
        model,
        output: null,
        error: err instanceof Error ? err.message : String(err),
        tokensUsed: 0,
        correlationId: input.correlationId,
      };
    }
  },
});
