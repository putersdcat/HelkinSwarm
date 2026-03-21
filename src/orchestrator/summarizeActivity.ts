// Summarize activity — condenses conversation history when token budget hits 80%.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';
import { FoundryClient, textContent } from '../llm/foundryClient.js';

export interface SummarizeInput {
  currentSummary: string;
  recentMessages: string;
  turnCount: number;
}

export interface SummarizeResult {
  summary: string;
  tokensUsed: number;
}

async function summarize(input: SummarizeInput): Promise<SummarizeResult> {
  const context = [
    input.currentSummary ? `Previous context:\n${input.currentSummary}` : '',
    `Recent activity (${input.turnCount} turns):\n${input.recentMessages}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const client = new FoundryClient();
    const result = await client.chatCompletion({
      messages: [
        {
          role: 'system',
          content: 'You are a summarization assistant. Condense the following conversation into a concise summary that preserves all key facts, decisions, user preferences, and pending actions. Keep it under 500 words.',
        },
        {
          role: 'user',
          content: context,
        },
      ],
      maxTokens: 800,
    });

    const choice = result.choices[0];
    return {
      summary: textContent(choice?.message?.content) || context.slice(-2000),
      tokensUsed: result.usage?.totalTokens ?? 0,
    };
  } catch (err) {
    // Fallback to truncation if LLM call fails
    // eslint-disable-next-line no-console
    console.error('[summarizeActivity] LLM summarization failed, using truncation fallback:', err);
    const fallback = context.length > 2000 ? context.slice(-2000) : context;
    return {
      summary: fallback,
      tokensUsed: Math.ceil(fallback.length / 4),
    };
  }
}

df.app.activity('summarizeActivity', {
  handler: async (input: SummarizeInput): Promise<SummarizeResult> => {
    return summarize(input);
  },
});
