import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('confirmation response identity source guards', () => {
  it('binds confirmation approval to the active correlation, tool batch, session instance, and user', () => {
    const sessionSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');
    const botSource = readFileSync('src/bot/HelkinSwarmBot.ts', 'utf8');

    expect(botSource).toContain("await this.durableClient.raiseEvent(instanceId, 'ConfirmationResponse', {");
    expect(botSource).toContain('userId: data.userId,');
    expect(botSource).toContain('sessionInstanceId: data.sessionInstanceId,');

    expect(sessionSource).toContain('const ConfirmationResponseSchema = z.object({');
    expect(sessionSource).toContain("action: z.enum(['approved', 'denied'])");
    expect(sessionSource).toContain('function isMatchingConfirmationResponse(');
    expect(sessionSource).toContain('response.sessionInstanceId === expected.sessionInstanceId');
    expect(sessionSource).toContain('response.toolName === expected.toolName');
    expect(sessionSource).toContain('response.userId === expected.userId');
    expect(sessionSource).toContain('Confirmation response did not match the active approval request. Action cancelled.');
  });
});