// Persist Swarm Result Activity — writes swarm execution metadata to Cosmos
// for the Swarm Activity viewer in Control Center.
// Stored in 'sessions' container (72h TTL, /userId partition).
// Epic: #631, Task: #635

import * as df from 'durable-functions';
import { getContainer } from '../../memory/cosmosClient.js';
import { recordOrchestratorStage } from '../../observability/orchestratorStageHealth.js';

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
  statusOverride?: 'running' | 'ok' | 'partial' | 'fail';
  agentCountOverride?: number;
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
  status: 'running' | 'ok' | 'partial' | 'fail';
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
  // [#710 Gap 1] Persist the leader's error string so the Swarm tab can
  // render a failure-summary card without requiring App Insights access.
  leaderError?: string;
  // [#710 Gap 2] Names of workers that fatally failed (after retry).
  // Surfaced in the Failure Summary card and the agent breakdown.
  failedAgents?: string[];
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
  // [#710 Gap 4] Honest status criterion. Three outcomes after run completes:
  //   - 'ok'      \u2014 leader OK AND every worker OK (clean run, no gaps).
  //   - 'partial' \u2014 leader OK but at least one worker failed; user got
  //                  an answer but with explicit gaps.
  //   - 'fail'    \u2014 leader did not produce a usable synthesis.
  // Caller-supplied statusOverride still wins (e.g. 'running' on first persist).
  const failedCount = (result.failedAgents ?? result.agentResults.filter(r => !r.success).map(r => r.agentName)).length;
  let computedStatus: 'ok' | 'partial' | 'fail';
  if (!result.success) {
    computedStatus = 'fail';
  } else if (failedCount > 0) {
    computedStatus = 'partial';
  } else {
    computedStatus = 'ok';
  }
  const status = input.statusOverride ?? computedStatus;

  return {
    id: `swarm-${input.swarmId}`,
    userId: input.userId,
    type: 'swarm-execution',
    correlationId: input.correlationId,
    swarmId: input.swarmId,
    userQuery: truncateText(input.userQuery, MAX_QUERY_CHARS),
    executedAt: new Date().toISOString(),
    status,
    success: result.success,
    executionDurationMs: input.executionDurationMs,
    agentCount: input.agentCountOverride ?? result.agentResults.length,
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
    // [#710 Gap 1] Truncate to MAX_AGENT_ERROR_CHARS so a giant stack trace cannot blow the doc-size budget.
    leaderError: truncateText(result.leaderResult.error, MAX_AGENT_ERROR_CHARS) || undefined,
    // [#710 Gap 2] Per-spec: ok if leader OK and majority of workers OK; partial if leader OK but some workers failed; fail otherwise.
    failedAgents: result.failedAgents && result.failedAgents.length > 0 ? result.failedAgents : undefined,
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
// #681 — defensive ceiling so a throttled Cosmos cannot hang the orchestrator
// turn. The SDK's default retry policy can otherwise retry for minutes under
// 429s, leaving the post-swarm orchestrator path with no visible stall point.
const COSMOS_UPSERT_TIMEOUT_MS = 15_000;

// #683 — Cosmos has a 2 MB hard limit on individual documents. The SDK's serializer
// is synchronous and blocks the event loop, so a setTimeout-based race cannot fire
// when stringification itself is the slow step. We pre-measure the doc size and:
//   - skip primary entirely if it's already over budget (forces compact path),
//   - throw a typed error if even compact is over budget (surfaced as stored:false).
const COSMOS_MAX_DOC_BYTES = 1_900_000; // ~1.9 MB safety margin under Cosmos 2 MB limit

export async function upsertWithTimeout(container: ReturnType<typeof getContainer>, doc: unknown, label: string): Promise<void> {
  // Pre-measure (synchronous, but bounded by leaderSynthesis/transcript caps in
  // buildSwarmExecutionDocument). If oversized, fail fast — do not enter the
  // SDK's internal serializer where the event loop will be blocked beyond the
  // setTimeout horizon.
  const serialized = JSON.stringify(doc);
  if (serialized.length > COSMOS_MAX_DOC_BYTES) {
    throw new Error(`cosmos upsert (${label}) payload too large: ${serialized.length} bytes > ${COSMOS_MAX_DOC_BYTES}`);
  }

  // Belt + suspenders: AbortController for the SDK's own network layer, plus
  // Promise.race against a setTimeout in case the SDK ignores the abort.
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      container.items.upsert(doc as Record<string, unknown>, { abortSignal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`cosmos upsert (${label}) exceeded ${COSMOS_UPSERT_TIMEOUT_MS}ms`));
        }, COSMOS_UPSERT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

df.app.activity('persistSwarmResultActivity', {
  handler: async (input: PersistSwarmResultInput): Promise<{ stored: boolean; error?: string }> => {
    // #681 — stamp the stage immediately so a hang here is visible in
    // correlate_runtime instead of masquerading as a generic post-swarm stall.
    try {
      await recordOrchestratorStage(input.correlationId, 'swarm-persist', input.userId);
    } catch {
      // stage health is best-effort; never fail the activity on telemetry
    }
    try {
      const container = getContainer(SESSIONS_CONTAINER);
      const doc = buildSwarmExecutionDocument(input);

      try {
        await upsertWithTimeout(container, doc, 'primary');
      } catch (firstErr) {
        const firstMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const compactDoc = buildSwarmExecutionDocument(input, {
          compact: true,
          warning: `Stored compact fallback after primary persistence failure: ${truncateText(firstMessage, 240)}`,
        });
        await upsertWithTimeout(container, compactDoc, 'compact');
      }

      return { stored: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[persistSwarmResult] Failed to persist swarm ${input.swarmId}: ${message}`);
      return { stored: false, error: message };
    }
  },
});
