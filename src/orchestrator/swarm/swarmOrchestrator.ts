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
import { ChatroomMessageSchema } from './swarmTypes.js';
import type { SwarmMemoryCommitInput } from './swarmMemoryCommitActivity.js';
import type { SwarmSubSessionInput, SwarmSubSessionResult } from './swarmSubSessionActivity.js';

// ---------------------------------------------------------------------------
// Timeout helpers (Durable timer pattern — same as #588/#591)
// ---------------------------------------------------------------------------

// Outer Durable timers race against activity completion in Task.any(). They MUST
// exceed the inner FoundryClient budget plus overhead, otherwise the timer wins
// before a legitimate cascade/retry can finish. Worker is per-round × maxRounds
// (default 4), so a 90s cascade budget needs plenty of headroom.
// #688 2026-04-21: previously 60_000, which preempted even a single cascade attempt.
const SWARM_WORKER_TIMEOUT_MS = 240_000;
const SWARM_LEADER_TIMEOUT_MS = 180_000;

function shouldRunLeaderDelegationPass(
  workerResults: ReadonlyArray<SwarmWorkerResult>,
  chatroomMessages: ReadonlyArray<ChatroomMessage>,
): boolean {
  if (workerResults.some((r) => r._requestsSecondPass === true)) {
    return true;
  }

  return chatroomMessages.some((msg) =>
    msg.contentType === 'question'
    || msg.contentType === 'cross_verification'
    || msg.contentType === 'sub_session_request',
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Durable Functions generator
df.app.orchestration('swarmOrchestrator', function* (context): Generator<df.Task, SwarmOrchestratorResult, any> {
  const input = context.df.getInput() as SwarmOrchestratorInput;
  const { plan, correlationId, userId, userMessage, parentBudgetMs } = input;
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

  // Wrap the entire swarm body so the chatroom entity is ALWAYS destroyed
  // on every exit path (success, fatal, thrown error). Without this, every
  // swarm leaks a zombie Running @swarmchatroom@... entity (#680).
  // signalEntity is a synchronous queued action (no yield), so it's safe to
  // invoke inside a generator's finally block.
  try {

  // -----------------------------------------------------------------------
  // 2. Fan-out: start all workers in parallel
  // -----------------------------------------------------------------------
  // [#707] Internal self-deadline. The parent (sessionOrchestrator) races
  // this sub-orchestrator against its own `swarmTimer` and forwards the same
  // budget here as `parentBudgetMs`. We arm an internal deadline a few
  // seconds shorter so the swarm can self-abort with a graceful partial
  // result BEFORE the parent's timer wins, eliminating the silent-orphan
  // race documented in #706 / #707. When `parentBudgetMs` is omitted (legacy
  // callers), no internal deadline is enforced.
  const SWARM_INTERNAL_DEADLINE_GRACE_MS = 30_000;
  const swarmStartUtcMs = context.df.currentUtcDateTime.getTime();
  const internalDeadlineUtcMs = typeof parentBudgetMs === 'number' && parentBudgetMs > SWARM_INTERNAL_DEADLINE_GRACE_MS
    ? swarmStartUtcMs + (parentBudgetMs - SWARM_INTERNAL_DEADLINE_GRACE_MS)
    : Number.POSITIVE_INFINITY;
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
  // 3. Fan-in: wait for all workers (or timeout) with retry logic (#664)
  // -----------------------------------------------------------------------
  const MAX_WORKER_RETRIES = 1;
  const workerResults: SwarmWorkerResult[] = [];
  const allChatroomMessages: ChatroomMessage[] = [];

  for (let i = 0; i < workerTasks.length; i++) {
    const winner = yield context.df.Task.any([workerTasks[i], workerTimers[i]]) as df.Task;
    let result: SwarmWorkerResult & { _pendingChatroomMessages?: ChatroomMessage[] };
    let failed = false;
    let retryCount = 0;

    if (winner === workerTimers[i]) {
      // Worker timed out — attempt retry
      failed = true;
      result = {
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
        retryAttempts: 0,
        fatal: false,
      };
    } else {
      workerTimers[i].cancel();
      try {
        result = workerTasks[i].result as SwarmWorkerResult & {
          _pendingChatroomMessages?: ChatroomMessage[];
        };
        if (!result.success) {
          failed = true;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed = true;
        result = {
          agentName: plan.agents[i].name,
          success: false,
          roundsUsed: 0,
          tokensUsed: 0,
          toolCallsMade: 0,
          chatroomMessagesSent: 0,
          toolsUsed: [],
          durationMs: SWARM_WORKER_TIMEOUT_MS,
          error: `Worker failed before returning a result: ${message.slice(0, 240)}`,
          model: 'error',
          retryAttempts: 0,
          fatal: false,
        };
      }
    }

    // Retry logic (#664): if worker failed, retry once before marking fatal
    if (failed && retryCount < MAX_WORKER_RETRIES) {
      // Attempt to re-summon the failed worker
      const retryInput: SwarmWorkerInput = {
        ...savedWorkerInputs[i],
        task: `RETRY: Your previous execution failed or timed out. Attempt to complete your assignment again. Original task: ${savedWorkerInputs[i].task}`,
      };
      const retryTimer = context.df.createTimer(
        new Date(context.df.currentUtcDateTime.getTime() + SWARM_WORKER_TIMEOUT_MS),
      );
      const retryTask = context.df.callActivity('swarmWorkerActivity', retryInput);
      const retryWinner = yield context.df.Task.any([retryTask, retryTimer]) as df.Task;
      retryTimer.cancel();
      retryCount++;

      if (retryWinner === retryTask) {
        try {
          const retryResult = retryTask.result as SwarmWorkerResult & {
            _pendingChatroomMessages?: ChatroomMessage[];
          };
          if (retryResult.success) {
            // Retry succeeded — use this result
            retryResult.retryAttempts = retryCount;
            retryResult.fatal = false;
            result = retryResult;
            failed = false;
          } else {
            // Retry also failed — mark fatal
            retryResult.retryAttempts = retryCount;
            retryResult.fatal = true;
            result = retryResult;
          }
        } catch {
          // Retry threw — mark fatal
          result.retryAttempts = retryCount;
          result.fatal = true;
        }
      } else {
        // Retry timed out — mark fatal
        result.retryAttempts = retryCount;
        result.fatal = true;
      }
    }

    // Collect chatroom messages from the worker (original or retry)
    if (result._pendingChatroomMessages) {
      allChatroomMessages.push(...result._pendingChatroomMessages);
    }

    // If fatally failed, abort the entire swarm (#664)
    if (result.fatal) {
      const failedAgent = result.agentName;
      const retryInfo = result.retryAttempts ? ` after ${result.retryAttempts} retry` : '';
      const errorMsg = result.error ? ` (${result.error.slice(0, 120)})` : '';

      // Build a failure synthesis message
      const failureSynthesis = `⚠️ **Swarm Failed — ${failedAgent} Could Not Be Summoned**\n\n` +
        `${failedAgent} failed${retryInfo} and could not be revived${errorMsg}. ` +
        `The swarm has been aborted. No partial answer will be provided. ` +
        `Please check the backend logs for model/timeout details and try again.`;

      // Build the final result with the failure
      const failureResult: SwarmOrchestratorResult = {
        response: failureSynthesis,
        success: false,
        totalTokensUsed: workerResults.reduce((s, r) => s + r.tokensUsed, 0),
        agentResults: [...workerResults, result],
        leaderResult: {
          synthesis: failureSynthesis,
          success: false,
          tokensUsed: 0,
          roundsUsed: 0,
          agentsHeardFrom: workerResults.map(r => r.agentName),
          model: 'swarm-fatal',
          error: `${failedAgent} fatally failed${retryInfo}${errorMsg}`,
        },
        chatroomTranscript: [...allChatroomMessages],
        swarmId: plan.swarmId,
        swarmCost: {
          decomposerTokens: 0,
          workerTokens: workerResults.reduce((s, r) => s + r.tokensUsed, 0),
          leaderTokens: 0,
          totalTokens: workerResults.reduce((s, r) => s + r.tokensUsed, 0),
          totalCost: workerResults.reduce((s, r) => s + ((r as SwarmWorkerResult & { cost?: number }).cost ?? 0), 0),
          agentBreakdown: workerResults.map(r => ({
            agent: r.agentName,
            tokens: r.tokensUsed,
            model: r.model,
            toolsUsed: r.toolsUsed,
            durationMs: r.durationMs,
            cost: (r as SwarmWorkerResult & { cost?: number }).cost,
          })),
        },
      };

      return failureResult;
    }

    // Not fatal — record the result
    workerResults.push(result);

    // [#707] Internal deadline check — if the parent's outer `swarmTimer`
    // is about to win, abort the fan-in loop with a graceful partial result
    // so the parent observes a clean return instead of a silently-orphaned
    // sub-orchestrator. The leader synthesis is intentionally SKIPPED here:
    // invoking it would burn another ≤180s and likely tip us past the
    // parent's hard cap.
    if (context.df.currentUtcDateTime.getTime() >= internalDeadlineUtcMs) {
      const completedAgents = workerResults.map(r => r.agentName).join(', ');
      const partialSynthesis = `⚡ **Swarm aborted by internal deadline (#707)**\n\n` +
        `The swarm reached its internal time budget (~${Math.round((parentBudgetMs ?? 0) / 1000)}s) ` +
        `before all workers and Helkin's synthesis could complete. ` +
        `Workers that returned: ${completedAgents || '(none)'}. ` +
        `No final synthesis was produced. Please retry, or break the request into a smaller question.`;
      const partialResult: SwarmOrchestratorResult = {
        response: partialSynthesis,
        success: false,
        totalTokensUsed: workerResults.reduce((s, r) => s + r.tokensUsed, 0),
        agentResults: [...workerResults],
        leaderResult: {
          synthesis: partialSynthesis,
          success: false,
          tokensUsed: 0,
          roundsUsed: 0,
          agentsHeardFrom: workerResults.map(r => r.agentName),
          model: 'swarm-internal-deadline',
          error: 'Internal deadline exceeded before leader synthesis (#707)',
        },
        chatroomTranscript: [...allChatroomMessages],
        swarmId: plan.swarmId,
        swarmCost: {
          decomposerTokens: 0,
          workerTokens: workerResults.reduce((s, r) => s + r.tokensUsed, 0),
          leaderTokens: 0,
          totalTokens: workerResults.reduce((s, r) => s + r.tokensUsed, 0),
          totalCost: workerResults.reduce((s, r) => s + ((r as SwarmWorkerResult & { cost?: number }).cost ?? 0), 0),
          agentBreakdown: workerResults.map(r => ({
            agent: r.agentName,
            tokens: r.tokensUsed,
            model: r.model,
            toolsUsed: r.toolsUsed,
            durationMs: r.durationMs,
            cost: (r as SwarmWorkerResult & { cost?: number }).cost,
          })),
        },
      };
      return partialResult;
    }

    // Send progress update after each worker completes (#634)
    if (input.conversationReference) {
      const completedCount = workerResults.length;
      const totalCount = workerTasks.length;
      const latestAgent = workerResults[workerResults.length - 1];
      const statusIcon = latestAgent.success ? '✓' : '✗';
      const suffix = completedCount === totalCount ? ' | Helkin synthesizing…' : '';
      const progressMsg = `${statusIcon} ${latestAgent.agentName} complete (${completedCount}/${totalCount})${suffix}`;
      // Fire-and-forget — progress delivery must not block the swarm.
      // [#697] Intentionally NO expectedInstanceId here: this is a sub-
      // orchestrator and its instanceId differs from the parent's, which is
      // the recorded stage owner. The fire-and-forget progress message is
      // skipOutboundClaim:true so cross-reboot replay risk is minimal.
      context.df.callActivity('sendReplyActivity', {
        userId,
        message: progressMsg,
        correlationId,
        conversationReference: input.conversationReference,
        skipOutboundClaim: true,
      });
    }
  }

  // -----------------------------------------------------------------------
  // 3.4. Leader delegation pass (#644 Slice 2 / #645)
  // Reliability hardening (#632 / #654): do NOT run this just because normal
  // first-pass results exist. Most swarms always emit partial_result messages,
  // and unnecessary coordination rounds can strand final delivery.
  // Only delegate when a worker explicitly asked for a second pass or when the
  // transcript still contains unresolved verification / question signals.
  // -----------------------------------------------------------------------
  const shouldRunDelegationPass = shouldRunLeaderDelegationPass(workerResults, allChatroomMessages);
  if (shouldRunDelegationPass) {
    const LEADER_DELEGATION_TIMEOUT_MS = 30_000;
    const delegationInput: SwarmLeaderInput & { chatroomTranscript: ChatroomMessage[] } = {
      leaderName,
      synthesisInstructions: plan.leader.synthesisInstructions,
      swarmId: plan.swarmId,
      swarmCorrelationId: correlationId,
      chatroomEntityId: `swarm-${plan.swarmId}`,
      userId,
      correlationId,
      userQuery: userMessage,
      agentNames: allAgentNames,
      timeoutMs: LEADER_DELEGATION_TIMEOUT_MS,
      chatroomTranscript: [...allChatroomMessages],
      delegationMode: true,
    };
    const delegationTimer = context.df.createTimer(
      new Date(context.df.currentUtcDateTime.getTime() + LEADER_DELEGATION_TIMEOUT_MS),
    );
    const delegationTask = context.df.callActivity('swarmLeaderActivity', delegationInput);
    const delegationWinner = yield context.df.Task.any([delegationTask, delegationTimer]) as df.Task;
    delegationTimer.cancel();
    if (delegationWinner === delegationTask) {
      try {
        const delegationResult = delegationTask.result as SwarmLeaderResult;
        if (delegationResult._pendingChatroomMessages?.length) {
          allChatroomMessages.push(...delegationResult._pendingChatroomMessages);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        allChatroomMessages.push({
          id: context.df.newGuid(`${correlationId}:leader-delegation-error`),
          from: 'Leader',
          to: 'Leader',
          content: `Leader delegation pass failed: ${message.slice(0, 240)}`,
          contentType: 'error',
          timestamp: context.df.currentUtcDateTime.getTime(),
          correlationId,
        });
      }
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

  // -----------------------------------------------------------------------
  // 3.4a. Sub-session interception (#638 Slice 2)
  // Scan allChatroomMessages for sub_session_request messages emitted by workers
  // (gated in swarmWorkerActivity). Execute each privileged tool call in an
  // isolated swarmSubSessionActivity. Inject sub_session_result messages back
  // so the requesting agent receives the output via second-pass injection.
  // -----------------------------------------------------------------------
  const subSessionRequests = allChatroomMessages.filter(m => m.contentType === 'sub_session_request');
  if (subSessionRequests.length > 0) {
    const SUB_SESSION_TIMEOUT_MS = 30_000;
    // Schedule all sub-sessions concurrently before any yield
    const subTasks = subSessionRequests.map(req => {
      let toolName = '';
      let toolArgs: Record<string, unknown> = {};
      let requestingAgent = req.from;
      try {
        const parsed = JSON.parse(req.content) as { toolName?: string; toolArgs?: Record<string, unknown>; requestingAgent?: string };
        toolName = parsed.toolName ?? '';
        toolArgs = parsed.toolArgs ?? {};
        requestingAgent = parsed.requestingAgent ?? req.from;
      } catch {
        // malformed content — will fail in the activity
      }
      return context.df.callActivity('swarmSubSessionActivity', {
        toolName,
        toolArgs,
        requestingAgent,
        requestMessageId: req.id,
        userId,
        correlationId,
        swarmId: plan.swarmId,
        swarmCorrelationId: correlationId,
      } satisfies SwarmSubSessionInput);
    });
    const subTimers = subSessionRequests.map(() =>
      context.df.createTimer(new Date(context.df.currentUtcDateTime.getTime() + SUB_SESSION_TIMEOUT_MS)),
    );

    for (let si = 0; si < subTasks.length; si++) {
      const winner = yield context.df.Task.any([subTasks[si], subTimers[si]]) as df.Task;
      subTimers[si].cancel();

      let resultMsg: ChatroomMessage;
      if (winner === subTimers[si]) {
        // Sub-session timed out
        resultMsg = {
          id: context.df.newGuid(`${correlationId}:sub-session-timeout:${si}`),
          from: 'Leader',
          to: subSessionRequests[si].from,
          content: `Sub-session timed out after ${SUB_SESSION_TIMEOUT_MS}ms — tool could not be executed`,
          contentType: 'sub_session_result',
          timestamp: context.df.currentUtcDateTime.getTime(),
          correlationId,
        };
      } else {
        try {
          const subResult = subTasks[si].result as SwarmSubSessionResult;
          const label = subResult.success ? 'Result' : 'Error';
          resultMsg = {
            id: context.df.newGuid(`${correlationId}:sub-session-result:${si}`),
            from: 'Leader',
            to: subResult.requestingAgent,
            content: `[Sub-session ${label} for ${subResult.toolName}]\n${subResult.resultContent}`,
            contentType: 'sub_session_result',
            timestamp: context.df.currentUtcDateTime.getTime(),
            correlationId,
            replyTo: subSessionRequests[si].id,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          resultMsg = {
            id: context.df.newGuid(`${correlationId}:sub-session-result-error:${si}`),
            from: 'Leader',
            to: subSessionRequests[si].from,
            content: `Sub-session failed before returning a result: ${message.slice(0, 240)}`,
            contentType: 'sub_session_result',
            timestamp: context.df.currentUtcDateTime.getTime(),
            correlationId,
            replyTo: subSessionRequests[si].id,
          };
        }
      }

      const validatedResult = ChatroomMessageSchema.safeParse(resultMsg);
      if (validatedResult.success) {
        allChatroomMessages.push(validatedResult.data);
      }
    }
  }

  const SECOND_PASS_TIMEOUT_MS = 20_000;
  const secondPassTasks: df.Task[] = [];
  const secondPassTimers: df.TimerTask[] = [];

  for (let i = 0; i < plan.agents.length; i++) {
    const agent = plan.agents[i];
    // Check if this worker explicitly yielded via swarm_wait (#646)
    const workerResult = workerResults[i] as SwarmWorkerResult & {
      _requestsSecondPass?: boolean;
      _waitingFor?: string[];
    };
    const requestedWait = workerResult._requestsSecondPass === true;
    const workerWaitingFor = workerResult._waitingFor ?? [];

    const inbound = allChatroomMessages.filter(msg =>
      typeof msg.to === 'string'
        ? msg.to === agent.name || msg.to === 'All'
        : (msg.to as string[]).includes(agent.name) || (msg.to as string[]).includes('All'),
    );
    // Run second pass if: (a) there are inbound messages, OR (b) agent called swarm_wait
    if (inbound.length === 0 && !requestedWait) continue;

    // Build context-aware task description based on why this pass is running
    let secondPassTask: string;
    if (requestedWait && inbound.length === 0) {
      // Timeout case: agent waited but no peer messages arrived
      secondPassTask =
        `You called swarm_wait(waitFor: [${workerWaitingFor.join(', ') || 'Any'}]). ` +
        `No messages arrived from them within the timeout. ` +
        `Resume your task and send your best available result to Helkin. ` +
        `Your original assignment: ${agent.task}`;
    } else if (requestedWait) {
      // Wait satisfied: agent waited and now has peer messages
      secondPassTask =
        `You called swarm_wait(waitFor: [${workerWaitingFor.join(', ') || 'Any'}]). ` +
        `Messages from your teammates are now available. ` +
        `Review them, incorporate the data you were waiting for, and send your findings to Helkin. ` +
        `Your original assignment: ${agent.task}`;
    } else {
      // Standard second pass: unsolicited inbound messages from peers
      secondPassTask =
        `Review messages your teammates sent you and send any additional insights or corrections to Helkin. ` +
        `Your completed assignment was: ${agent.task}`;
    }

    const secondPassInput: SwarmWorkerInput = {
      ...savedWorkerInputs[i],
      task: secondPassTask,
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
    const winner = yield context.df.Task.any([secondPassTasks[i], secondPassTimers[i]]) as df.Task;
    secondPassTimers[i].cancel();
    if (winner === secondPassTasks[i]) {
      try {
        const result = secondPassTasks[i].result as SwarmWorkerResult & {
          _pendingChatroomMessages?: ChatroomMessage[];
        };
        // Only collect new messages for Leader's transcript — don't pollute workerResults
        if (result._pendingChatroomMessages) {
          allChatroomMessages.push(...result._pendingChatroomMessages);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        allChatroomMessages.push({
          id: context.df.newGuid(`${correlationId}:second-pass-error:${i}`),
          from: 'Leader',
          to: 'Leader',
          content: `Second-pass worker failed: ${message.slice(0, 240)}`,
          contentType: 'error',
          timestamp: context.df.currentUtcDateTime.getTime(),
          correlationId,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Signal chatroom entity with all collected messages (fire-and-forget,
  //    kept for external reads / audit trail but not relied on for the
  //    synthesis path — see step 5)
  // -----------------------------------------------------------------------
  for (const msg of allChatroomMessages) {
    context.df.signalEntity(chatroomEntityId, 'send', msg);
  }

  // -----------------------------------------------------------------------
  // 5. Build transcript from the messages the orchestrator already collected.
  //
  //    IMPORTANT: Do NOT use context.df.callEntity(..., 'transcript') here.
  //    The entity receives the same messages via the signals above, but Azure
  //    Storage entity operations process signals sequentially. With 20-40
  //    large sub-session results queued before the callEntity, the entity call
  //    blocks for minutes and can hang indefinitely (seen when deep_research
  //    results are injected into the transcript). The orchestrator owns
  //    allChatroomMessages which is the canonical set — use it directly.
  // -----------------------------------------------------------------------
  const transcript: ChatroomMessage[] = [...allChatroomMessages];

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
    try {
      leaderResult = leaderTask.result as SwarmLeaderResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      leaderResult = {
        synthesis: '⚡ The swarm gathered partial results but Helkin failed during synthesis. Here is the available audit trail:\n\n' +
          allChatroomMessages
            .filter(m => m.contentType === 'partial_result' || m.contentType === 'text' || m.contentType === 'error')
            .map(m => `**${m.from}**: ${m.content}`)
            .join('\n\n'),
        success: false,
        tokensUsed: 0,
        roundsUsed: 0,
        agentsHeardFrom: [...new Set(allChatroomMessages.map(m => m.from))],
        model: 'error',
        error: `Helkin synthesis failed: ${message.slice(0, 240)}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // 7. Leader-only memory commit to T3 (fire-and-forget — don't block
  //    the user response on memory persistence)
  //    Spec ref: docs/0zi §6 — Leader-Only Memory Commit
  // -----------------------------------------------------------------------
  // Commit memory when the leader succeeded, OR when workers found useful results
  // even if the leader synthesis failed. This preserves research from partial swarms.
  const anyWorkerSucceeded = workerResults.some(r => r.success);
  if (transcript.length > 0 && (leaderResult.success || anyWorkerSucceeded)) {
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
  // 8. Build final result with cost tracking (#633 Task 4 / #664)
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
      totalCost: workerResults.reduce((s, r) => s + ((r as SwarmWorkerResult & { cost?: number }).cost ?? 0), 0),
      agentBreakdown: workerResults.map(r => ({
        agent: r.agentName,
        tokens: r.tokensUsed,
        model: r.model,
        toolsUsed: r.toolsUsed,
        durationMs: r.durationMs,
        cost: (r as SwarmWorkerResult & { cost?: number }).cost,
      })),
    },
  };

  return result;
  } finally {
    // #680 — destroy the chatroom entity on every exit path so it doesn't
    // linger as a zombie Running instance. signalEntity is a queued no-yield
    // action, so running it in a generator finally is safe.
    context.df.signalEntity(chatroomEntityId, 'destroy');
  }
});
