// Summarize activity — condenses conversation history when token budget hits 80%.
// Spec ref: 08-Orchestrator-Patterns.md

import * as df from 'durable-functions';

export interface SummarizeInput {
  currentSummary: string;
  recentMessages: string;
  turnCount: number;
}

export interface SummarizeResult {
  summary: string;
  tokensUsed: number;
}

function summarize(input: SummarizeInput): SummarizeResult {
  // Phase 3 will call the LLM to produce a real summary.
  // For now, concatenate + trim to keep the flow working.
  const combined = [
    input.currentSummary ? `Previous context: ${input.currentSummary}` : '',
    `Recent activity (${input.turnCount} turns): ${input.recentMessages}`,
  ]
    .filter(Boolean)
    .join('\n');

  // Truncate to a reasonable stub length
  const summary = combined.length > 2000 ? combined.slice(-2000) : combined;

  return {
    summary,
    tokensUsed: Math.ceil(summary.length / 4),
  };
}

df.app.activity('summarizeActivity', {
  handler: (input: SummarizeInput): SummarizeResult => {
    return summarize(input);
  },
});
