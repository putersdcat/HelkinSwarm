// Source-level verification: sendReplyActivity falls through to a fresh
// sendActivity when an ack updateActivity times out for a FINAL reply
// (outbound claim guards against duplicates). Intermediate acks
// (skipOutboundClaim=true) preserve the original #329 suppression.
// Issue: #696

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src', 'orchestrator', 'sendReplyActivity.ts'),
  'utf-8',
);

describe('sendReplyActivity — final-reply ack timeout fall-through (#696)', () => {
  it('branches on input.skipOutboundClaim inside the timeout handler', () => {
    expect(src).toContain('if (!input.skipOutboundClaim) {');
  });

  it('final-reply branch issues a fresh sendActivity on timeout', () => {
    // The final-reply branch must call turnContext.sendActivity with replyChunks[0].text
    expect(src).toMatch(
      /falling through to fresh sendActivity[\s\S]{0,400}turnContext\.sendActivity\(\{[\s\S]{0,200}text: replyChunks\[0\]!\.text/,
    );
  });

  it('intermediate-ack branch still suppresses to avoid duplicate (#329)', () => {
    expect(src).toContain('Intermediate ack');
    expect(src).toContain('avoid duplicate');
  });

  it('both branches set firstChunkSent and deliveredToUser', () => {
    // Two timeout sub-paths each end with firstChunkSent = true; deliveredToUser = true;
    const matches = src.match(/firstChunkSent = true;[\s\S]{0,40}deliveredToUser = true;/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('cites #696 in the timeout-handler comments', () => {
    expect(src).toContain('#696');
  });
});
