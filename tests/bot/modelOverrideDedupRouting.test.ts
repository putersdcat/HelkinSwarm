import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('HelkinSwarmBot overseer dedup routing discriminator', () => {
  it('includes model override and skillforge state in the durable dedup hash input', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain("const routingDiscriminator = [");
    expect(source).toContain("`model:${modelOverride ?? 'default'}`");
    expect(source).toContain("`skillforge:${skillForgeRequest ? 'on' : 'off'}`");
    expect(source).toContain('`${userId}:${bucket}:${routingDiscriminator}:${userMessage.slice(0, 200)}`');
  });
});