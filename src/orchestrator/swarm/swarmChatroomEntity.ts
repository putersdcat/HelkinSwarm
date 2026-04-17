// SwarmChatroomEntity — Durable Entity for inter-agent message routing.
// One entity per swarm turn. All agents signal/call this entity to communicate.
// Spec ref: docs/0zg, docs/0ze §3.3
// Epic: #631

import * as df from 'durable-functions';
import type { ChatroomMessage, SwarmChatroomState } from './swarmTypes.js';

df.app.entity('SwarmChatroom', (ctx) => {
  const state = ctx.df.getState(() => ({
    swarmCorrelationId: '',
    registeredAgents: [] as string[],
    queues: {} as Record<string, ChatroomMessage[]>,
    transcript: [] as ChatroomMessage[],
    messagesCount: 0,
    createdAt: Date.now(),
  })) as SwarmChatroomState;

  switch (ctx.df.operationName) {
    // Initialize chatroom with agent names
    case 'init': {
      const input = ctx.df.getInput() as { swarmCorrelationId: string; agents: string[] };
      state.swarmCorrelationId = input.swarmCorrelationId;
      state.registeredAgents = input.agents;
      for (const agent of input.agents) {
        state.queues[agent] = [];
      }
      state.createdAt = Date.now();
      break;
    }

    // Send a message — route to recipients' queues
    case 'send': {
      const msg = ctx.df.getInput() as ChatroomMessage;

      // Validate sender is registered
      if (!state.registeredAgents.includes(msg.from)) {
        break;
      }

      state.transcript.push(msg);
      state.messagesCount++;

      const recipients = msg.to === 'All'
        ? state.registeredAgents.filter((a: string) => a !== msg.from)
        : Array.isArray(msg.to)
          ? msg.to
          : [msg.to];

      for (const r of recipients) {
        if (state.queues[r]) {
          state.queues[r].push(msg);
        }
        // Messages to unregistered agents are silently dropped
      }
      break;
    }

    // Drain all pending messages for an agent
    case 'drain': {
      const agentName = ctx.df.getInput() as string;
      const messages = state.queues[agentName] ?? [];
      state.queues[agentName] = [];
      ctx.df.return(messages);
      ctx.df.setState(state);
      return; // early return — drain changes state (clears queue)
    }

    // Get the full transcript (for observability / Leader synthesis)
    case 'transcript': {
      ctx.df.return(state.transcript);
      return;
    }

    // Get stats (for monitoring)
    case 'stats': {
      ctx.df.return({
        messagesCount: state.messagesCount,
        registeredAgents: state.registeredAgents,
        pendingByAgent: Object.fromEntries(
          Object.entries(state.queues).map(([k, v]) => [k, (v as ChatroomMessage[]).length]),
        ),
      });
      return;
    }

    // Terminal operation: mark this entity for deletion after the current
    // operation completes. The orchestrator MUST signal this on every exit
    // path — otherwise the entity persists forever as a zombie Running
    // instance in the Sessions tab (#680).
    case 'destroy': {
      ctx.df.destructOnExit();
      return;
    }
  }

  ctx.df.setState(state);
});
