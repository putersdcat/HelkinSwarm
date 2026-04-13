// Swarm Sub-Orchestrator — manages the full swarm lifecycle.
// Fan-out: start all workers in parallel. Fan-in: collect results, run Leader.
// Spec ref: docs/0ze §4, docs/0zg §5
// Epic: #631

import * as df from 'durable-functions';
import type {
  ChatroomMessage,
  SwarmOrchestratorInput,
  SwarmOrchestratorResult,
  SwarmWorkerInput,
  SwarmWorkerResult,
  SwarmLeaderInput,
  SwarmLeaderResult,
} from './swarmTypes.js';
import type { SwarmMemoryCommitInput } from './swarmMemoryCommitActivity.js';

// ---------------------------------------------------------------------------
// Timeout helpers (Durable timer pattern — same as #588/#591)
// ---------------------------------------------------------------------------

const SWARM_WORKER_TIMEOUT_MS = 60_000;
const SWARM_LEADER_TIMEOUT_MS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Durable Functions generator
df.app.orchestration('swarmOrchestrator', function* (context): Generator<df.Task, SwarmOrchestratorResult, any> {
  const input = context.df.getInput() as SwarmOrchestratorInput;
  const { plan, correlationId, userId, userMessage } = input;
  const allAgentNames = plan.agents.map(a => a.name);
  const leaderName = plan.leader.name;
  const allNames = [leaderName, ...allAgentNames];

  // -----------------------------------------------------------------------
  // 1. Initialize the chatroom entity (fire-and-forget — workers collect
  //    messages locally and don't interact with entity directly)
  // -----------------------------------------------------------------------
  const chatroomEntityId = new df.EntityId(
    'SwarmChatroom',
    `swarm-${plan.swarmId}`,
  );

  context.df.signalEntity(chatroomEntityId, 'init', {
    swarmCorrelationId: correlationId,
    agents: allNames,
  });

  // -----------------------------------------------------------------------
  // 2. Fan-out: start all workers in parallel
  // -----------------------------------------------------------------------
  const workerTasks: df.Task[] = [];
  const workerTimers: df.TimerTask[] = [];
  // Save inputs so the second-pass block can reuse them for follow-up activities (#644 Slice 1)
  const savedWorkerInputs: SwarmWorkerInput[] = [];

  for (const agent of plan.agents) {
    const workerInput: SwarmWorkerInput = {
      agentName: agent.name,
      agentRole: agent.role,
      agentPersona: agent.persona,
      task: agent.task,
      assignedTools: agent.assignedTools,
      allAgentNames,
      swarmId: plan.swarmId,
      swarmCorrelationId: correlationId,
      chatroomEntityId: `swarm-${plan.swarmId}`,
      userId,
      correlationId,
      maxRounds: plan.maxRoundsPerAgent,
      userQuery: userMessage,
      tokenBudget: agent.tokenBudget,
      modelOverride: agent.modelOverride,
      personaFile: agent.personaFile,
    };

    workerTasks.push(context.df.callActivity('swarmWorkerActivity', workerInput));
    workerTimers.push(context.df.createTimer(
      new Date(context.df.currentUtcDateTime.getTime() + SWARM_WORKER_TIMEOUT_MS),
    ));
    savedWorkerInputs.push(workerInput);
  }

  // -----------------------------------------------------------------------
  // 3. Fan-in: wait for all workers (or timeout)
  // -----------------------------------------------------------------------
  const workerResults: SwarmWorkerResult[] = [];
  const allChatroomMessages: ChatroomMessage[] = [];

  for (let i = 0; i < workerTasks.length; i++) {
    const winner = yield context.df.Task.any([workerTasks[i], workerTimers[i]]) as df.Task;

    if (winner === workerTimers[i]) {
      // Worker timed out
      workerResults.push({
        agentName: plan.agents[i].name,
        success: false,
        roundsUsed: 0,
        tokensUsed: 0,
        toolCallsMade: 0,
        chatroomMessagesSent: 0,
        toolsUsed: [],
        durationMs: SWARM_WORKER_TIMEOUT_MS,
        error: `Worker timed out after ${SWARM_WORKER_TIMEOUT_MS}ms`,
        model: 'timeout',
      });
    } else {
      workerTimers[i].cancel();
      const result = workerTasks[i].result as SwarmWorkerResult & {
        _pendingChatroomMessages?: ChatroomMessage[];
      };
      workerResults.push(result);

      // Collect chatroom messages from the worker
      if (result._pendingChatroomMessages) {
        allChatroomMessages.push(...result._pendingChatroomMessages);
      }
    }

    // Send progress update after each worker completes (#634)
    if (input.conversationReference) {
      const completedCount = workerResults.length;
      const totalCount = workerTasks.length;
      const latestAgent = workerResults[workerResults.length - 1];
      const statusIcon = latestAgent.success ? '✓' : '✗';
      const suffix = completedCount === totalCount ? ' | Helkin synthesizing…' : '';
      const progressMsg = `${statusIcon} ${latestAgent.agentName} complete (${completedCount}/${totalCount})${suffix}`;
      // Fire-and-forget — progress delivery must not block the swarm
      context.df.callActivity('sendReplyActivity', {
        userId,
        message: progressMsg,
        correlationId,
        conversationReference: input.conversationReference,
      });
    }
  }

  // -----------------------------------------------------------------------
  // 3.5. Second-pass: route inbound messages back to each agent (#644 Slice 1)
  // Workers run as Durable Activities (no entity access), so they cannot receive
  // peer messages mid-execution. After all workers finish, route collected
  // cross-agent messages to their recipients for a brief 1-2 round refinement
  // pass before Leader synthesis.
  // Only agents with inbound messages get a second-pass activity.
  // -----------------------------------------------------------------------
  const SECOND_PASS_TIMEOUT_MS = 20_000;
  const secondPassTasks: df.Task[] = [];
  const secondPassTimers: df.TimerTask[] = [];

  for (let i = 0; i < plan.agents.length; i++) {
    const agent = plan.agents[i];
    const inbound = allChatroomMessages.filter(msg =>
      typeof msg.to === 'string'
        ? msg.to === agent.name || msg.to === 'All'
        : (msg.to as string[]).includes(agent.name) || (msg.to as string[]).includes('All'),
    );
    if (inbound.length === 0) continue;

    const secondPassInput: SwarmWorkerInput = {
      ...savedWorkerInputs[i],
      task: `Review messages your teammates sent you and send any additional insights or corrections to Helkin. Your completed assignment was: ${agent.task}`,
      inboundMessages: inbound,
      maxRounds: Math.min(2, plan.maxRoundsPerAgent),
      // Token budget not tracked for second pass — it's a brief refinement only
      tokenBudget: undefined,
    };

    secondPassTasks.push(context.df.callActivity('swarmWorkerActivity', secondPassInput));
    secondPassTimers.push(context.df.createTimer(
      new Date(context.df.currentUtcDateTime.getTime() + SECOND_PASS_TIMEOUT_MS),
    ));
  }

  // Fan-in second-pass activities (activities started in parallel above)
  for (let i = 0; i < secondPassTasks.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Durable Functions generator
    const winner = yield context.df.Task.any([secondPassTasks[i], secondPassTimers[i]]) as df.Task;
    secondPassTimers[i].cancel();
    if (winner === secondPassTasks[i]) {
      const result = secondPassTasks[i].result as SwarmWorkerResult & {
        _pendingChatroomMessages?: ChatroomMessage[];
      };
      // Only collect new messages for Leader's transcript — don't pollute workerResults
      if (result._pendingChatroomMessages) {
        allChatroomMessages.push(...result._pendingChatroomMessages);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Signal chatroom entity with all collected messages
  // -----------------------------------------------------------------------
  for (const msg of allChatroomMessages) {
    context.df.signalEntity(chatroomEntityId, 'send', msg);
  }

  // -----------------------------------------------------------------------
  // 5. Get full transcript from entity
  // -----------------------------------------------------------------------
  const transcript = (yield context.df.callEntity(
    chatroomEntityId,
    'transcript',
  )) as ChatroomMessage[];

  // -----------------------------------------------------------------------
  // 6. Run the Leader to synthesize
  // -----------------------------------------------------------------------
  const leaderInput: SwarmLeaderInput & { chatroomTranscript: ChatroomMessage[] } = {
    leaderName,
    synthesisInstructions: plan.leader.synthesisInstructions,
    swarmId: plan.swarmId,
    swarmCorrelationId: correlationId,
    chatroomEntityId: `swarm-${plan.swarmId}`,
    userId,
    correlationId,
    userQuery: userMessage,
    agentNames: allAgentNames,
    timeoutMs: plan.timeoutMs,
    chatroomTranscript: transcript,
  };

  const leaderTimer = context.df.createTimer(
    new Date(context.df.currentUtcDateTime.getTime() + SWARM_LEADER_TIMEOUT_MS),
  );
  const leaderTask = context.df.callActivity('swarmLeaderActivity', leaderInput);
  const leaderWinner = yield context.df.Task.any([leaderTask, leaderTimer]) as df.Task;

  let leaderResult: SwarmLeaderResult;
  if (leaderWinner === leaderTimer) {
    leaderResult = {
      synthesis: '⚡ The swarm gathered results but Helkin\'s synthesis timed out. Here are the partial findings:\n\n' +
        allChatroomMessages
          .filter(m => m.contentType === 'partial_result' || m.contentType === 'text')
          .map(m => `**${m.from}**: ${m.content}`)
          .join('\n\n'),
      success: false,
      tokensUsed: 0,
      roundsUsed: 0,
      agentsHeardFrom: [...new Set(allChatroomMessages.map(m => m.from))],
      model: 'timeout',
      error: 'Helkin synthesis timed out',
    };
  } else {
    leaderTimer.cancel();
    leaderResult = leaderTask.result as SwarmLeaderResult;
  }

  // -----------------------------------------------------------------------
  // 7. Leader-only memory commit to T3 (fire-and-forget — don't block
  //    the user response on memory persistence)
  //    Spec ref: docs/0zi §6 — Leader-Only Memory Commit
  // -----------------------------------------------------------------------
  if (leaderResult.success && transcript.length > 0) {
    const commitInput: SwarmMemoryCommitInput = {
      userId,
      correlationId,
      swarmId: plan.swarmId,
      userQuery: userMessage,
      leaderSynthesis: leaderResult.synthesis,
      chatroomTranscript: transcript,
    };
    // Best-effort — memory commit failure must not fail the swarm response
    context.df.callActivity('swarmMemoryCommitActivity', commitInput);
  }

  // -----------------------------------------------------------------------
  // 8. Build final result with cost tracking (#633 Task 4)
  // -----------------------------------------------------------------------
  const workerTokens = workerResults.reduce((sum, r) => sum + r.tokensUsed, 0);
  const totalTokens = workerTokens + leaderResult.tokensUsed;

  const result: SwarmOrchestratorResult = {
    response: leaderResult.synthesis,
    success: leaderResult.success && workerResults.some(r => r.success),
    totalTokensUsed: totalTokens,
    agentResults: workerResults,
    leaderResult,
    chatroomTranscript: transcript,
    swarmId: plan.swarmId,
    swarmCost: {
      decomposerTokens: 0, // tracked in parent orchestrator
      workerTokens,
      leaderTokens: leaderResult.tokensUsed,
      totalTokens,
      agentBreakdown: workerResults.map(r => ({
        agent: r.agentName,
        tokens: r.tokensUsed,
        model: r.model,
        toolsUsed: r.toolsUsed,
        durationMs: r.durationMs,
      })),
    },
  };

  return result;
});
