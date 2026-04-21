import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('[#700] swarm final reply uses forceNewMessage to avoid silent in-place no-op', () => {
  const sendReplySource = readFileSync('src/orchestrator/sendReplyActivity.ts', 'utf8');
  const orchestratorSource = readFileSync('src/orchestrator/sessionOrchestrator.ts', 'utf8');

  it('SendReplyInput exposes a forceNewMessage flag', () => {
    expect(sendReplySource).toMatch(/forceNewMessage\?:\s*boolean/);
  });

  it('forceNewMessage suppresses the getPendingAckId lookup so updateActivity is never called', () => {
    // The ackActivityId resolution must short-circuit to null when forceNewMessage is set.
    expect(sendReplySource).toMatch(
      /\(SENDREPLY_FAST_PATH\s*\|\|\s*input\.forceNewMessage\)\s*\?\s*null/,
    );
  });

  it('swarm final-reply call site passes forceNewMessage: true', () => {
    // The call must live in the swarm branch — co-locate with the swarmResponse text.
    const idx = orchestratorSource.indexOf('swarmFinalReply');
    expect(idx).toBeGreaterThan(-1);
    const slice = orchestratorSource.slice(idx, idx + 800);
    expect(slice).toContain('forceNewMessage: true');
    expect(slice).toContain('message: swarmResponse');
  });

  it('swarm engagement-card call site keeps skipOutboundClaim: true (so the ack and final claim are independent)', () => {
    // Ensures we did not accidentally remove the engagement card's claim-skip.
    const idx = orchestratorSource.indexOf('swarmAckMessage');
    expect(idx).toBeGreaterThan(-1);
    const slice = orchestratorSource.slice(idx, idx + 800);
    expect(slice).toContain('skipOutboundClaim: true');
  });
});
