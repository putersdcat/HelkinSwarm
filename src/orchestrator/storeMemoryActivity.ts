// Store Memory activity — persists conversation turns to vector memory.
// Called by sessionOrchestrator after a successful LLM turn.
// Spec ref: 07-Memory-Manager.md
// Issue: #134

import * as df from 'durable-functions';
import { MemoryManager } from '../memory/memoryManager.js';

const STORE_MEMORY_TIMEOUT_MS = 10_000;

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`storeMemoryActivity timed out after ${timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        reject(timeoutError);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export interface StoreMemoryInput {
  userId: string;
  userMessage: string;
  assistantReply: string;
}

df.app.activity('storeMemoryActivity', {
  handler: async (input: StoreMemoryInput): Promise<{ stored: boolean }> => {
    try {
      const mm = new MemoryManager(input.userId);
      await withTimeout(
        mm.storeConversationTurn(input.userMessage, input.assistantReply),
        STORE_MEMORY_TIMEOUT_MS,
      );
      return { stored: true };
    } catch (err) {
      console.warn(
        `[storeMemoryActivity] Skipping memory write after timeout/error: ${err instanceof Error ? err.message : err}`,
      );
      // Memory storage is non-critical — don't fail the turn
      return { stored: false };
    }
  },
});
