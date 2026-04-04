import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop new-message injection proof surface', () => {
  it('exposes an owner-only helper that raises NewMessage into the active living session', () => {
    const source = readFileSync('src/functions/devLoopRelay.ts', 'utf8');

    expect(source).toContain("route: 'devloop/new-message'");
    expect(source).toContain("import { queueBufferedNewMessage } from '../orchestrator/bufferedIngressActivity.js';");
    expect(source).toContain('const [activeTurnEntries, resolvedOverseerStatus] = await Promise.all([');
    expect(source).toContain('getActiveTurnStagesForUser(userId),');
    expect(source).toContain('const OverseerCustomStatusSchema = z.object({');
    expect(source).toContain('client.getStatus(resolvedInstanceId)');
    expect(source).toContain('recordLimbicIngressDecision({');
    expect(source).toContain("source: 'devloop-relay'");
    expect(source).toContain('compatibilityMode: getEnvConfig().livingMindCompatibilityMode');
    expect(source).toContain('const resolvedInstanceId = body.instanceIdOverride');
    expect(source).toContain('?? await resolveDeliverableOverseerInstanceId(client, userId);');
    expect(source).toContain('const shouldBuffer = shouldBufferNewMessageForActiveProcessing(');
    expect(source).toContain('await queueBufferedNewMessage(event, userId, resolvedInstanceId);');
    expect(source).toContain("await client.raiseEvent(resolvedInstanceId, 'BufferedIngressQueued', {");
    expect(source).toContain("await client.raiseEvent(resolvedInstanceId, 'NewMessage', event);");
    expect(source).toContain("endpoint: 'new-message'");
    expect(source).toContain('deliveredToOverseer: true,');
    expect(source).toContain("deliveryMode: shouldBuffer ? 'buffered-active-processing' : 'external-event'");
    expect(source).toContain("activeOverseerStage: resolvedOverseerCustomStatus?.stage ?? null");
    expect(source).toContain('correlationPrefix: z.string().min(3).max(80).default(\'devloop-injected\')');
    expect(source).toContain('instanceIdOverride: z.string().min(1).optional()');
    expect(source).toContain('status: 500,');
    expect(source).toContain('jsonBody: {');
    expect(source).toContain('error: message,');
  });
});