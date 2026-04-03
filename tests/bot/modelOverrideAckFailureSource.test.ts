import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('model override ack failure source guards', () => {
  it('terminalizes accepted override placeholders when handoff fails before the overseer takes over', () => {
    const source = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(source).toContain('private async replaceAckWithCommandFailureNotice(');
    expect(source).toContain("Failed to update command-failure ack placeholder");
    expect(source).toContain("⚠️ This forced-model turn failed before it reached the living session. Please retry.");
    expect(source).toContain("⚠️ This direct-model turn failed before it reached the living session. Please retry.");
    expect(source).toContain('override handoff failed for correlationId=');
    expect(source).toContain('direct model override handoff failed for correlationId=');
  });
});