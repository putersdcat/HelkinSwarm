import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('external event overseer routing source guards', () => {
  it('routes external events through the active one-shot overseer resolver', () => {
    const hookReceiver = readFileSync('src/functions/hookReceiver.ts', 'utf8');
    const graphNotificationHandler = readFileSync('src/functions/graphNotificationHandler.ts', 'utf8');
    const devLoopRelay = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(hookReceiver).toContain("import { resolveActiveOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';");
    expect(hookReceiver).toContain('const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, body.userId);');
    expect(hookReceiver).toContain('recordLimbicIngressDecision({');
    expect(hookReceiver).toContain("source: 'hook-fired'");
    expect(hookReceiver).toContain('compatibilityMode: getEnvConfig().livingMindCompatibilityMode');
    expect(hookReceiver).toContain("await client.raiseEvent(activeOverseerInstanceId, 'HookFired', firedPayload);");
    expect(hookReceiver).toContain("name: 'DurableHookTriggered'");
    expect(hookReceiver).toContain('instanceId: activeOverseerInstanceId,');

    expect(graphNotificationHandler).toContain("import { resolveActiveOverseerInstanceId } from '../orchestrator/activeOverseerInstance.js';");
    expect(graphNotificationHandler).toContain("import { getEnvConfig } from '../config/envConfig.js';");
    expect(graphNotificationHandler).toContain("import { recordLimbicIngressDecision } from '../orchestrator/limbicIngressActivity.js';");
    expect(graphNotificationHandler).toContain('const activeOverseerInstanceId = await resolveActiveOverseerInstanceId(client, userId);');
    expect(graphNotificationHandler).toContain('recordLimbicIngressDecision({');
    expect(graphNotificationHandler).toContain("source: 'graph-notification'");
    expect(graphNotificationHandler).toContain('compatibilityMode: getEnvConfig().livingMindCompatibilityMode');
    expect(graphNotificationHandler).toContain("await client.raiseEvent(activeOverseerInstanceId, 'HookFired', firedPayload);");

    expect(devLoopRelay).toContain('resolveDeliverableOverseerInstanceId');
    expect(devLoopRelay).toContain("const activeOverseerInstanceId = await resolveDeliverableOverseerInstanceId(client, userId);");
    expect(devLoopRelay).toContain("source: 'devloop-relay'");
    expect(devLoopRelay).toContain("await client.raiseEvent(activeOverseerInstanceId, 'NewMessage', event);");
    expect(devLoopRelay).toContain('const resolvedInstanceId = body.instanceIdOverride');
  });
});