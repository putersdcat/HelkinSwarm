// Store Memory activity — persists conversation turns to vector memory.
// Called by sessionOrchestrator after a successful LLM turn.
// Spec ref: 07-Memory-Manager.md
// Issue: #134

import * as df from 'durable-functions';
import { MemoryManager } from '../memory/memoryManager.js';

export interface StoreMemoryInput {
  userId: string;
  userMessage: string;
  assistantReply: string;
}

df.app.activity('storeMemoryActivity', {
  handler: async (input: StoreMemoryInput): Promise<{ stored: boolean }> => {
    try {
      const mm = new MemoryManager(input.userId);
      await mm.storeConversationTurn(input.userMessage, input.assistantReply);
      return { stored: true };
    } catch {
      // Memory storage is non-critical — don't fail the turn
      return { stored: false };
    }
  },
});
