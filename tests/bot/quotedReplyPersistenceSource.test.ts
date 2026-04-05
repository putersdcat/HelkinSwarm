import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('quoted reply persistence source guards', () => {
  it('falls back to persisted bot-sent message text before lossy messageReference previews', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const storeSource = readFileSync('src/bot/conversationStore.ts', 'utf8');
    const replySource = readFileSync('src/orchestrator/sendReplyActivity.ts', 'utf8');

    expect(botSource).toContain('const stored = await getStoredSentMessage(replyToId, activity.conversation?.id);');
    expect(botSource).toContain("source: 'store'");
    expect(storeSource).toContain('export async function saveSentMessageText(');
    expect(storeSource).toContain('export async function getStoredSentMessage(');
    expect(replySource).toContain('await saveSentMessageText(userId, conversationId, activityId, text);');
  });
});