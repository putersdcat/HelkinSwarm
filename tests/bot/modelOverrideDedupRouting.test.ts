import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot overseer dedup routing discriminator', () => {
  it('includes model override and skillforge state in the durable dedup hash input', () => {
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');
    const helperSource = readFileSync('src/bot/overseerDedupIdentity.ts', 'utf8');

    expect(botSource).toContain("import { buildOverseerDedupIdentity } from './overseerDedupIdentity.js';");
    expect(botSource).toContain('const identity = buildOverseerDedupIdentity({');
    expect(botSource).toContain('modelOverride,');
    expect(botSource).toContain('skillForgeRequest,');
    expect(botSource).toContain('messageId,');

    expect(helperSource).toContain('const routingDiscriminator = [');
    expect(helperSource).toContain("`model:${input.modelOverride ?? 'default'}`");
    expect(helperSource).toContain("`skillforge:${input.skillForgeRequest ? 'on' : 'off'}`");
    expect(helperSource).toContain("`message:${input.messageId ?? 'none'}`");
    expect(helperSource).toContain('const dedupBasis = input.messageId ?? input.userMessage.slice(0, 200);');
    expect(helperSource).toContain('`${input.userId}:${bucket}:${routingDiscriminator}:${dedupBasis}`');
  });
});