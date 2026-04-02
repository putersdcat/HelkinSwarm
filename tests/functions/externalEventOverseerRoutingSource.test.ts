import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('external event overseer routing source guards', () => {
  it('routes external events through the active one-shot overseer resolver', () => {
    const hookReceiver = readFileSync('src/functions/hookReceiver.ts', 'utf8');
    const graphNotificationHandler = readFileSync('src/functions/graphNotificationHandler.ts', 'utf8');
    const devLoopRelay = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(hookReceiver).toContain("import { resolveActiveOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';");
    expect(hookReceiver).toContain('const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, body.userId);');
    expect(hookReceiver).toContain('await client.raiseEvent(activeOverseerInstanceId, `HookFired_${body.hookId}`, firedPayload);');

    expect(graphNotificationHandler).toContain("import { resolveActiveOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';");
    expect(graphNotificationHandler).toContain('const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, userId);');
    expect(graphNotificationHandler).toContain('await client.raiseEvent(activeOverseerInstanceId, `HookFired_${hookId}`, firedPayload);');

    expect(devLoopRelay).toContain("import { resolveActiveOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';");
    expect(devLoopRelay).toContain("const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, userId);");
    expect(devLoopRelay).toContain("await client.raiseEvent(activeOverseerInstanceId, 'DevLoopMessage', {");
    expect(devLoopRelay).toContain('const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, targetUserId);');
  });
});