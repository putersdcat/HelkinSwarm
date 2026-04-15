// Swarm Memory Commit Activity — leader-only T3 write after each swarm turn.
// Selects high-value chatroom messages and persists them to long-term memory.
// Workers are forbidden from T3 writes — only this activity (called by the
// orchestrator after leader synthesis) commits to MemoryManager.
// Spec ref: docs/0zi §5.2, §6
// Epic: #631, Task: #633

import * as df from 'durable-functions';
import { MemoryManager } from '../../memory/memoryManager.js';
import { trackEvent } from '../../observability/telemetry.js';
import type { ChatroomMessage } from './swarmTypes.js';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface SwarmMemoryCommitInput {
  userId: string;
  correlationId: string;
  swarmId: string;
  userQuery: string;
  leaderSynthesis: string;
  chatroomTranscript: ChatroomMessage[];
}

export interface SwarmMemoryCommitResult {
  entriesStored: number;
  skippedMessages: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// High-value message selection heuristic (§5.2 / Task 3)
// ---------------------------------------------------------------------------

/** Content types worth persisting to T3 */
const HIGH_VALUE_TYPES = new Set<string>([
  'partial_result',
  'cross_verification',
]);

/** Content types explicitly excluded */
const LOW_VALUE_TYPES = new Set<string>([
  'status',
  'delegation',
  'question',
  'vote',
  'error',
]);

/** Minimum content length to be worth persisting */
const MIN_CONTENT_LENGTH = 50;

export function selectHighValueMessages(
  transcript: ChatroomMessage[],
): ChatroomMessage[] {
  return transcript.filter(msg => {
    // Always exclude low-value types
    if (LOW_VALUE_TYPES.has(msg.contentType)) return false;
    // High-value types pass if they have enough content
    if (HIGH_VALUE_TYPES.has(msg.contentType)) {
      return msg.content.length >= MIN_CONTENT_LENGTH;
    }
    // Generic 'text' messages pass only if substantial
    return msg.content.length >= MIN_CONTENT_LENGTH * 2;
  });
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

df.app.activity('swarmMemoryCommitActivity', {
  handler: async (input: SwarmMemoryCommitInput): Promise<SwarmMemoryCommitResult> => {
    const { userId, correlationId, swarmId, userQuery, leaderSynthesis, chatroomTranscript } = input;

    const mm = new MemoryManager(userId);
    let entriesStored = 0;

    try {
      // 1. Store the user query
      await mm.store({
        content: userQuery,
        tags: ['swarm', 'query'],
        metadata: { source: 'swarm', type: 'query', swarmId, correlationId },
      });
      entriesStored++;

      // 2. Store the leader synthesis (the final answer)
      if (leaderSynthesis.length > 0) {
        await mm.store({
          content: leaderSynthesis,
          tags: ['swarm', 'synthesis'],
          metadata: { source: 'swarm', type: 'synthesis', swarmId, correlationId },
        });
        entriesStored++;
      }

      // 3. Select and store high-value chatroom messages under each agent's own vault partition.
      // Helkin's vault only receives synthesis + query; worker research goes to per-agent vaults (#659).
      const highValue = selectHighValueMessages(chatroomTranscript);
      for (const msg of highValue) {
        // Route to the sending agent's vault (e.g. 'agent:harper') — not Helkin's default vault.
        const agentSkillId = msg.from.toLowerCase() !== 'helkin'
          ? `agent:${msg.from.toLowerCase()}`
          : undefined;
        await mm.store({
          content: msg.content,
          tags: ['swarm', 'partial', msg.contentType],
          skillId: agentSkillId,
          metadata: {
            source: 'swarm',
            type: 'partial',
            agent: msg.from,
            swarmId,
            correlationId,
            contentType: msg.contentType,
          },
        });
        entriesStored++;
      }

      const skippedMessages = chatroomTranscript.length - highValue.length;

      trackEvent({
        name: 'SwarmMemoryCommitCompleted',
        correlationId,
        userId,
        properties: {
          swarmId,
          entriesStored,
          skippedMessages,
          highValueCount: highValue.length,
          transcriptLength: chatroomTranscript.length,
        },
      });

      return { entriesStored, skippedMessages };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      trackEvent({
        name: 'SwarmMemoryCommitError',
        correlationId,
        properties: { swarmId, error: errorMessage, entriesStored },
      });
      return { entriesStored, skippedMessages: chatroomTranscript.length, error: errorMessage };
    }
  },
});
