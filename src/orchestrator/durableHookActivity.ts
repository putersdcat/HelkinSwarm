// Durable Hook activities — register, list, cancel, and manage persistent workflow hooks.
// Spec ref: ADDENDA-08-Durable-Hooks-and-Relay-Protocol.md, 0h-Long-Running-Workflows.md

import * as df from 'durable-functions';
import {
  registerHook,
  listActiveHooks,
  cancelHook,
  pauseAllHooksForUser,
  expireOverdueHooks,
  type RegisterHookInput,
  type RegisterHookResult,
} from './hookCatalog.js';

// ---------------------------------------------------------------------------
// Types re-exported for activity callers
// ---------------------------------------------------------------------------

export type { RegisterHookInput, RegisterHookResult };

export interface ListHooksInput {
  userId: string;
}

export interface CancelHookInput {
  hookId: string;
  userId: string;
}

export interface PauseAllHooksInput {
  userId: string;
}

export interface PauseAllHooksResult {
  paused: number;
}

export interface ExpireHooksInput {
  userId: string;
}

export interface ExpireHooksResult {
  expired: number;
}

// ---------------------------------------------------------------------------
// Activity: Register a durable hook in Cosmos
// ---------------------------------------------------------------------------

df.app.activity('registerHookActivity', {
  handler: async (input: RegisterHookInput): Promise<RegisterHookResult> => {
    return registerHook(input);
  },
});

// ---------------------------------------------------------------------------
// Activity: List active hooks for a user (used by overseer after ContinueAsNew)
// ---------------------------------------------------------------------------

df.app.activity('listActiveHooksActivity', {
  handler: async (input: ListHooksInput): Promise<string[]> => {
    const hooks = await listActiveHooks(input.userId);
    return hooks.map((h) => h.id);
  },
});

// ---------------------------------------------------------------------------
// Activity: Cancel a specific hook
// ---------------------------------------------------------------------------

df.app.activity('cancelHookActivity', {
  handler: async (input: CancelHookInput): Promise<{ cancelled: boolean }> => {
    await cancelHook(input.hookId, input.userId);
    return { cancelled: true };
  },
});

// ---------------------------------------------------------------------------
// Activity: Emergency pause all hooks for a user
// ---------------------------------------------------------------------------

df.app.activity('pauseAllHooksActivity', {
  handler: async (input: PauseAllHooksInput): Promise<PauseAllHooksResult> => {
    const paused = await pauseAllHooksForUser(input.userId);
    return { paused };
  },
});

// ---------------------------------------------------------------------------
// Activity: Expire overdue hooks for a user
// ---------------------------------------------------------------------------

df.app.activity('expireHooksActivity', {
  handler: async (input: ExpireHooksInput): Promise<ExpireHooksResult> => {
    const expired = await expireOverdueHooks(input.userId);
    return { expired };
  },
});
