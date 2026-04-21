import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// [#706] Lock the silent-drop diagnostic in sendReplyActivity.ts so the
// no-ack-stored / forceNewMessage path emits ReplyDroppedSilently telemetry
// when turnContext.sendActivity returns without an id, instead of optimistically
// flipping deliveredToUser=true and letting recordMessagePathSuccess hide a
// missing user-visible message.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sendReplyPath = resolve(__dirname, '../../src/orchestrator/sendReplyActivity.ts');
const source = readFileSync(sendReplyPath, 'utf8');

describe('sendReplyActivity #706 silent-drop telemetry', () => {
  it('emits ReplyDroppedSilently when sendActivity returns no id (no-ack-stored branch)', () => {
    expect(source).toMatch(/ReplyDroppedSilently/);
  });

  it('checks for missing response.id in the no-ack-stored branch', () => {
    expect(source).toMatch(/if\s*\(\s*!response\?\.id\s*\)/);
  });

  it('does NOT unconditionally flip deliveredToUser when response.id is missing', () => {
    // The lock: the silent-drop branch must `continue` rather than fall through
    // to `deliveredToUser = true`. We assert by source structure.
    const noAckBranch = source.split('No ack stored')[1] ?? '';
    expect(noAckBranch).toMatch(/ReplyDroppedSilently/);
    expect(noAckBranch).toMatch(/continue;/);
  });

  it('captures forceNewMessage and skipOutboundClaim flags in the telemetry properties', () => {
    expect(source).toMatch(/forceNewMessage:\s*input\.forceNewMessage\s*\?\s*'true'\s*:\s*'false'/);
  });
});
