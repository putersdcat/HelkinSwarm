// Persist Swarm Result Activity — writes swarm execution metadata to Cosmos
// for the Swarm Activity viewer in Control Center.
// Stored in 'sessions' container (72h TTL, /userId partition).
// Epic: #631, Task: #635

import * as df from 'durable-functions';
import { getContainer } from '../../memory/cosmosClient.js';

import type {
  SwarmOrchestratorResult,
  SwarmWorkerResult,
  SwarmCost,
  ChatroomMessage,
} from './swarmTypes.js';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface PersistSwarmResultInput {
  userId: string;
  correlationId: string;
  swarmId: string;
  userQuery: string;
  decomposerTokens: number;
  decomposerModel: string;
  executionDurationMs: number;
  result: SwarmOrchestratorResult;
}

// ---------------------------------------------------------------------------
// Cosmos document shape
// ---------------------------------------------------------------------------

interface SwarmExecutionDocument {
  id: string;
  userId: string;
  type: 'swarm-execution';
  correlationId: string;
  swarmId: string;
  userQuery: string;
  executedAt: string;
  success: boolean;
  executionDurationMs: number;
  agentCount: number;
  totalTokensUsed: number;
  decomposerTokens: number;
  decomposerModel: string;
  swarmCost: SwarmCost | undefined;
  agentResults: SwarmWorkerResult[];
  chatroomTranscript: ChatroomMessage[];
  leaderSynthesis: string;
  leaderModel: string;
  leaderAgentsHeardFrom: string[];
  transcriptTruncated: boolean;
  persistenceMode: 'full' | 'compact-fallback';
  persistenceWarning?: string;
  ttl: number;
}

const MAX_QUERY_CHARS = 1000;
const MAX_SYNTHESIS_CHARS = 4000;
const MAX_MESSAGE_CHARS = 1200;
const MAX_TRANSCRIPT_MESSAGES = 80;
const MAX_AGENT_ERROR_CHARS = 300;

function truncateText(value: string | undefined, maxChars: number): string {
  if (!value) return '';
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 1))}…` : value;
}

function compactTranscript(transcript: ChatroomMessage[]): { messages: ChatroomMessage[]; truncated: boolean } {
  const trimmedToWindow = transcript.length > MAX_TRANSCRIPT_MESSAGES
    ? transcript.slice(-MAX_TRANSCRIPT_MESSAGES)
    : transcript;

  const compacted = trimmedToWindow.map((message) => ({
    ...message,
    content: truncateText(message.content, MAX_MESSAGE_CHARS),
  }));

  const truncated = transcript.length !== compacted.length
    || transcript.some((message) => message.content.length > MAX_MESSAGE_CHARS);

  return { messages: compacted, truncated };
}

export function buildSwarmExecutionDocument(
  input: PersistSwarmResultInput,
  options?: { compact?: boolean; warning?: string },
): SwarmExecutionDocument {
  const result = input.result;
  const transcript = compactTranscript(result.chatroomTranscript);
  const compact = options?.compact ?? false;

  return {
    id: `swarm-${input.swarmId}`,
    userId: input.userId,
    type: 'swarm-execution',
    correlationId: input.correlationId,
    swarmId: input.swarmId,
    userQuery: truncateText(input.userQuery, MAX_QUERY_CHARS),
    executedAt: new Date().toISOString(),
    success: result.success,
    executionDurationMs: input.executionDurationMs,
    agentCount: result.agentResults.length,
    totalTokensUsed: result.totalTokensUsed + input.decomposerTokens,
    decomposerTokens: input.decomposerTokens,
    decomposerModel: input.decomposerModel,
    swarmCost: result.swarmCost,
    agentResults: result.agentResults.map((agent) => ({
      ...agent,
      error: truncateText(agent.error, MAX_AGENT_ERROR_CHARS) || undefined,
    })),
    chatroomTranscript: compact ? transcript.messages.slice(-20) : transcript.messages,
    leaderSynthesis: truncateText(result.leaderResult.synthesis, compact ? 1500 : MAX_SYNTHESIS_CHARS),
    leaderModel: result.leaderResult.model,
    leaderAgentsHeardFrom: result.leaderResult.agentsHeardFrom,
    transcriptTruncated: compact || transcript.truncated,
    persistenceMode: compact ? 'compact-fallback' : 'full',
    persistenceWarning: options?.warning,
    ttl: SWARM_EXECUTION_TTL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const SESSIONS_CONTAINER = 'sessions';
const SWARM_EXECUTION_TTL_SECONDS = 72 * 60 * 60; // 72 hours

df.app.activity('persistSwarmResultActivity', {
  handler: async (input: PersistSwarmResultInput): Promise<{ stored: boolean; error?: string }> => {
    try {
      const container = getContainer(SESSIONS_CONTAINER);
      const doc = buildSwarmExecutionDocument(input);

      try {
        await container.items.upsert(doc);
      } catch (firstErr) {
        const firstMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const compactDoc = buildSwarmExecutionDocument(input, {
          compact: true,
          warning: `Stored compact fallback after primary persistence failure: ${truncateText(firstMessage, 240)}`,
        });
        await container.items.upsert(compactDoc);
      }

      return { stored: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[persistSwarmResult] Failed to persist swarm ${input.swarmId}: ${message}`);
      return { stored: false, error: message };
    }
  },
});
