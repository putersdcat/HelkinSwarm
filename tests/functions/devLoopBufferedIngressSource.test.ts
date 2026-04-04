import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('devloop buffered ingress proof seam source guards', () => {
  it('registers owner-only buffered ingress inspection and manual replay endpoints', () => {
    const source = readFileSync('src/functions/devLoopBufferedIngress.ts', 'utf8');
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');
    const bufferedIngressSource = readFileSync('src/orchestrator/bufferedIngressActivity.ts', 'utf8');

    expect(indexSource).toContain("import './devLoopBufferedIngress.js';");
    expect(source).toContain("app.http('devloopBufferedIngressList'");
    expect(source).toContain("route: 'devloop/buffered-ingress'");
    expect(source).toContain("app.http('devloopBufferedIngressReplay'");
    expect(source).toContain("route: 'devloop/buffered-ingress/replay'");
    expect(source).toContain("No queued buffered follower found for that correlationId.");
    expect(source).toContain("A living session is still actively processing; manual replay is blocked until active turns drain.");
    expect(source).toContain("await client.raiseEvent(deliverableOverseerInstanceId, 'NewMessage', queuedFollower.event);");
    expect(source).toContain("replayMode: 'raise-event'");
    expect(source).toContain("let replayMode: 'raise-event' | 'start-new';");
    expect(source).toContain("replayMode = 'start-new';");
    expect(source).toContain("source: 'buffered-ingress-manual-replay'");
    expect(source).toContain("name: 'BufferedIngressFallbackReplayed'");
    expect(bufferedIngressSource).toContain('export async function listBufferedIngressDocumentsForUser(');
    expect(bufferedIngressSource).toContain('export async function getQueuedBufferedReplayCandidateByCorrelation(');
  });
});