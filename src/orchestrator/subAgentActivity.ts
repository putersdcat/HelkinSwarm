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
import { isPlaceholderScopedToken, scopedTokenMinter } from '../auth/scopedTokenMinter.js';
import type { ScopedTokenScope } from '../auth/scopedTokenMinter.js';
import type { StepModel } from './planActivity.js';
import { mapPrivilegeClassToScopedTokenScope } from '../auth/tokenScopeMapping.js';
import {
  buildInstrumentalSubSessionSystemPrompt,
  CONSCIOUS_THREAD_EXECUTION_KIND,
  INSTRUMENTAL_SUB_SESSION_EXECUTION_KIND,
} from './autonomicSubSessionContract.js';

export interface SubAgentInput {
  toolName: string;
  toolDescription: string;
  toolInputSchema?: Record<string, unknown>;
  arguments: Record<string, unknown>;
  userContext: string;
  correlationId: string;
  sessionId: string;
  userId: string;
  round?: 'initial' | 'followup';
  preferredModel?: StepModel;
  planStepOrder?: number;
}

export interface SubAgentResult {
  success: boolean;
  model: string;
  output: unknown;
  error?: string;
  tokensUsed: number;
  correlationId: string;
  scopedTokenMinted?: boolean;
  scopedTokenMethod?: 'obo' | 'placeholder';
  scopedTokenScope?: ScopedTokenScope;
}

function resolvePreferredModel(preferredModel: StepModel | undefined): { deploymentName: string; isReasoning: boolean } {
  switch (preferredModel) {
    case 'reasoning':
      return { deploymentName: getModelForTask('reasoning'), isReasoning: true };
    case 'primary': {
      const routing = getModelRouting();
      return { deploymentName: routing.lane.primary, isReasoning: routing.lane.primary.includes('reasoning') || routing.lane.primary.startsWith('o') };
    }
    default:
      return { deploymentName: getModelForTask('fast'), isReasoning: false };
  }
}

df.app.activity('subAgentActivity', {
  handler: async (input: SubAgentInput): Promise<SubAgentResult> => {
    // Create a client using the secondary (fast) model — fresh routing, no shared state
    const baseRouting = getModelRouting();
    const { deploymentName: secondaryModel, isReasoning } = resolvePreferredModel(input.preferredModel);
    const client = new FoundryClient({
      ...baseRouting,
      deploymentName: secondaryModel,
      isReasoning,
    });

    const tool = toolRegistry.get(input.toolName);

    // Defense-in-depth: reject tools that violate current safety mode (#210)
    if (!toolRegistry.isAllowedBySafetyMode(input.toolName)) {
      return {
        success: false,
        model: secondaryModel,
        output: null,
        error: `Tool ${input.toolName} blocked by safety mode`,
        tokensUsed: 0,
        correlationId: input.correlationId,
      };
    }

    // Emit spawn-boundary telemetry (#321)
    trackEvent({
      name: 'SubAgentSpawned',
      correlationId: input.correlationId,
      userId: input.userId,
      properties: {
        toolName: input.toolName,
        model: secondaryModel,
        executionKind: INSTRUMENTAL_SUB_SESSION_EXECUTION_KIND,
        returnsControlTo: CONSCIOUS_THREAD_EXECUTION_KIND,
        contextBoundary: 'minimal-scoped-context',
        privilegeClass: tool?.privilegeClass ?? 'unknown',
        round: input.round ?? 'initial',
        planStepOrder: input.planStepOrder ?? -1,
      },
    });

    // Build minimal context — ONLY what the sub-agent needs for this one tool
    const systemPrompt = buildInstrumentalSubSessionSystemPrompt({
      toolName: input.toolName,
      toolDescription: input.toolDescription,
    });

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
      // Sub-agents must fail fast — use a shorter budget than the main 90s orchestrator
      // budget so a slow model doesn't block the conscious thread for 3+ minutes (#591).
      const SUB_AGENT_LLM_BUDGET_MS = 30_000;
      const response = await client.chatCompletion({
        messages,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: tools.length > 0 ? 'auto' : undefined,
        maxTokens: 1024,
        temperature: 0.1,
        correlationId: input.correlationId,
        maxBudgetMs: SUB_AGENT_LLM_BUDGET_MS,
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
        parsedArgs['correlationId'] = input.correlationId;
        let scopedTokenMinted = false;
        let scopedTokenMethod: 'obo' | 'placeholder' | undefined;
        let scopedTokenScope: ScopedTokenScope | undefined;

        // Mint scoped token for non-read-only tools (#317)
        // Hard-cap the entire mint() call so Cosmos SDK retry loops (10×requestTimeout)
        // cannot hold this activity for 100s+ (#591 part 6).
        const MINT_TIMEOUT_MS = 20_000;
        const tokenScope = mapPrivilegeClassToScopedTokenScope(tool?.privilegeClass);
        if (tokenScope) {
          try {
            let mintTimer: ReturnType<typeof setTimeout> | undefined;
            const scopedToken = await Promise.race([
              scopedTokenMinter.mint({
                toolName: tc.function.name,
                scope: tokenScope,
                targetResource: tool?.handlerModule?.replace('skills/', '') || 'core',
                userId: input.userId,
                correlationId: input.correlationId,
              }),
              new Promise<never>((_, reject) => {
                mintTimer = setTimeout(() => {
                  reject(new Error(`scopedTokenMinter.mint timed out after ${MINT_TIMEOUT_MS}ms for ${tc.function.name}`));
                }, MINT_TIMEOUT_MS);
              }),
            ]).finally(() => {
              if (mintTimer) clearTimeout(mintTimer);
            });
            if (!isPlaceholderScopedToken(scopedToken.token)) {
              parsedArgs['_scopedToken'] = scopedToken.token;
            }
            parsedArgs['_scopedTokenScope'] = scopedToken.scope;
            parsedArgs['_scopedTokenMethod'] = scopedToken.method;
            scopedTokenMinted = true;
            scopedTokenMethod = scopedToken.method;
            scopedTokenScope = scopedToken.scope;
          } catch {
            // Non-fatal: handler falls back to legacy token acquisition (#318)
          }
        }

        // Hard-cap the handler execution so any internal hang (network, Cosmos, etc.)
        // cannot hold this activity indefinitely (#591 part 6).
        const HANDLER_TIMEOUT_MS = 60_000;
        let handlerTimer: ReturnType<typeof setTimeout> | undefined;
        const handlerResult = await Promise.race([
          handler(parsedArgs),
          new Promise<never>((_, reject) => {
            handlerTimer = setTimeout(() => {
              reject(new Error(`Handler ${tc.function.name} timed out after ${HANDLER_TIMEOUT_MS}ms`));
            }, HANDLER_TIMEOUT_MS);
          }),
        ]).finally(() => {
          if (handlerTimer) clearTimeout(handlerTimer);
        });

        trackEvent({
          name: 'SubAgentToolExecuted',
          correlationId: input.correlationId,
          userId: input.userId,
          properties: {
            toolName: tc.function.name,
            success: true,
            model: secondaryModel,
            executionKind: INSTRUMENTAL_SUB_SESSION_EXECUTION_KIND,
            returnsControlTo: CONSCIOUS_THREAD_EXECUTION_KIND,
            privilegeClass: tool?.privilegeClass ?? 'unknown',
            scopedTokenScope: String(parsedArgs['_scopedTokenScope'] ?? 'none'),
            scopedTokenMethod: String(parsedArgs['_scopedTokenMethod'] ?? 'none'),
            round: input.round ?? 'initial',
          },
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
          scopedTokenMinted,
          scopedTokenMethod,
          scopedTokenScope,
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
        properties: {
          toolName: input.toolName,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          executionKind: INSTRUMENTAL_SUB_SESSION_EXECUTION_KIND,
          returnsControlTo: CONSCIOUS_THREAD_EXECUTION_KIND,
        },
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
