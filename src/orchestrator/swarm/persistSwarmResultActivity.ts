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
  ttl: number;
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
      const result = input.result;

      const doc: SwarmExecutionDocument = {
        id: `swarm-${input.swarmId}`,
        userId: input.userId,
        type: 'swarm-execution',
        correlationId: input.correlationId,
        swarmId: input.swarmId,
        userQuery: input.userQuery,
        executedAt: new Date().toISOString(),
        success: result.success,
        executionDurationMs: input.executionDurationMs,
        agentCount: result.agentResults.length,
        totalTokensUsed: result.totalTokensUsed + input.decomposerTokens,
        decomposerTokens: input.decomposerTokens,
        decomposerModel: input.decomposerModel,
        swarmCost: result.swarmCost,
        agentResults: result.agentResults,
        chatroomTranscript: result.chatroomTranscript,
        leaderSynthesis: result.leaderResult.synthesis,
        leaderModel: result.leaderResult.model,
        leaderAgentsHeardFrom: result.leaderResult.agentsHeardFrom,
        ttl: SWARM_EXECUTION_TTL_SECONDS,
      };

      await container.items.upsert(doc);

      return { stored: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[persistSwarmResult] Failed to persist swarm ${input.swarmId}: ${message}`);
      return { stored: false, error: message };
    }
  },
});
