import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot overseer dedup guard routing', () => {
  it('passes Teams activity ids into durable dedup and suppresses duplicate placeholders', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const helperSource = readFileSync('src/bot/overseerDedupIdentity.ts', 'utf8');

    expect(source).toContain('import { buildOverseerDedupIdentity } from \'./overseerDedupIdentity.js\';');
    expect(source).toContain('messageId?: string,');
    expect(source).toContain('await this.findExistingOverseerInstance(');
    expect(source).toContain('context.activity.id,');
    expect(source).toContain('await this.suppressDuplicateAck(context, userId, correlationId, ackResponse.id);');
    expect(helperSource).toContain('message:${input.messageId ?? \'none\'}');
  });
});