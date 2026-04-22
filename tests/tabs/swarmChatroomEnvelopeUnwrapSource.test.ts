import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-pinning lock for #684 — Swarm chatroom transcript JSON envelope
// unwrap. Some models (e.g. minimax-m2.7 without a model-specific persona)
// emit the canonical chatroom envelope `{messageType, content, confidence,
// sender}` as raw JSON inside the `content` field. The Swarm tab transcript
// renderer in tabs/app.js sniffs and unwraps so the chat bubble shows the
// human-readable text, not the raw struct. These textual assertions guard
// the unwrap so a future refactor cannot silently revert it (tabs/app.js
// has no behavioral test suite — pinning the source is the gate).

const appSrc = readFileSync(
  join(process.cwd(), 'tabs', 'app.js'),
  'utf-8',
);

describe('Swarm chatroom transcript JSON envelope unwrap (#684)', () => {
  it('renderBubble carries the #684 unwrap comment so reviewers see the rationale', () => {
    expect(appSrc).toContain('#684');
    expect(appSrc).toMatch(/internal chatroom envelope as raw JSON/i);
  });

  it('renderBubble sniffs `{` or `[` prefix before parsing (cheap pre-check)', () => {
    expect(appSrc).toMatch(
      /rawContent\.charAt\(0\)\s*===\s*'\{'\s*\|\|\s*rawContent\.charAt\(0\)\s*===\s*'\['/,
    );
  });

  it('renderBubble JSON.parses inside try/catch so malformed JSON falls through unchanged', () => {
    expect(appSrc).toMatch(/JSON\.parse\(rawContent\)/);
    // The catch must NOT rethrow — must render raw content as-is on parse failure.
    expect(appSrc).toMatch(/catch\s*\(\s*jsonErr\s*\)\s*\{\s*\/\/[^\n]*Not valid JSON/);
  });

  it('renderBubble validates envelope shape (object + string content + messageType OR sender)', () => {
    expect(appSrc).toContain("typeof parsed.content === 'string'");
    expect(appSrc).toContain("typeof parsed.messageType === 'string'");
    expect(appSrc).toContain("typeof parsed.sender === 'string'");
  });

  it('renderBubble extracts parsed.content and adopts parsed.messageType as type chip', () => {
    expect(appSrc).toContain('rawContent = parsed.content;');
    expect(appSrc).toContain('typeLabel = parsed.messageType;');
  });

  it('renderBubble appends " unwrapped" suffix to the type chip so the unwrap is visible in UI', () => {
    expect(appSrc).toContain("envelopeLabel = ' unwrapped';");
    expect(appSrc).toMatch(/envelopeLabel\s*\?\s*esc\(envelopeLabel\)\s*:\s*""/);
  });
});
