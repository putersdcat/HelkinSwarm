import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('buffered ingress replay timer wiring', () => {
  it('replays stale queued buffered followers only when no living session remains active', () => {
    const timerSource = readFileSync('src/functions/bufferedIngressReplayTimer.ts', 'utf8');
    const bufferedIngressSource = readFileSync('src/orchestrator/bufferedIngressActivity.ts', 'utf8');
    const indexSource = readFileSync('src/functions/index.ts', 'utf8');

    expect(indexSource).toContain("import './bufferedIngressReplayTimer.js';");
    expect(timerSource).toContain("app.timer('bufferedIngressReplayTimer'");
    expect(timerSource).toContain('listStaleQueuedBufferedMessages(cutoffIso)');
    expect(timerSource).toContain('resolveDeliverableOverseerInstanceId(client, queuedFollower.userId)');
    expect(timerSource).toContain('getActiveTurnCountForUser(queuedFollower.userId)');
    expect(timerSource).toContain("await client.startNew('overseer', { instanceId: replayInstanceId, input: queuedFollower.event });");
    expect(timerSource).toContain("source: 'buffered-ingress-replay'");
    expect(timerSource).toContain("name: 'BufferedIngressFallbackReplayed'");
    expect(bufferedIngressSource).toContain("status: z.enum(['queued', 'dequeued', 'replayed']).default('queued')");
    expect(bufferedIngressSource).toContain('export async function listStaleQueuedBufferedMessages(');
    expect(bufferedIngressSource).toContain('export async function markBufferedNewMessageReplayed(');
    expect(bufferedIngressSource).toContain("status: 'replayed'");
  });
});