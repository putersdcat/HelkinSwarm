// Source-level lockdown for #701: the swarm detail panel's chatroom transcript
// must split by contentType. Operational events ('status' per-round worker
// activity from #695, 'sub_session_request' elevated-tool requests) must
// render in a collapsed "Activity Log" section, not polluting the primary
// intra-agent Chatroom Transcript card.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'tabs', 'app.js'), 'utf8');

describe('tabs/app.js — chatroom transcript split (#701)', () => {
  it('defines the operational content-type partition set with status + sub_session_request', () => {
    expect(src).toContain('var OPERATIONAL_CONTENT_TYPES = { status: true, sub_session_request: true };');
  });

  it('partitions transcript into chatroomMessages (non-operational) and activityLog (operational)', () => {
    expect(src).toContain('var chatroomMessages = transcript.filter(function (m) {');
    expect(src).toContain("return !OPERATIONAL_CONTENT_TYPES[m.contentType || 'text'];");
    expect(src).toContain('var activityLog = transcript.filter(function (m) {');
    expect(src).toContain("return !!OPERATIONAL_CONTENT_TYPES[m.contentType || 'text'];");
  });

  it('renders the Chatroom Transcript card with chatroomMessages.length, not the raw transcript.length', () => {
    expect(src).toContain("html += '<div class=\"card\"><h2>Chatroom Transcript (' + chatroomMessages.length + ' messages)</h2>'");
    // Guard against regression to the un-split total count.
    expect(src).not.toMatch(/Chatroom Transcript \(' \+ transcript\.length/);
  });

  it('renders the Activity Log card inside a collapsed <details> when activityLog.length > 0', () => {
    expect(src).toContain('if (activityLog.length > 0) {');
    expect(src).toContain("html += '<div class=\"card\"><details><summary><h2 style=\"display:inline;margin:0\">Activity Log (' + activityLog.length + ' events)</h2></summary>'");
  });

  it('extracts bubble rendering into a renderBubble helper so both sections share the same formatting', () => {
    expect(src).toContain('function renderBubble(m) {');
    expect(src).toContain('chatroomMessages.map(renderBubble).join("")');
    expect(src).toContain('activityLog.map(renderBubble).join("")');
  });

  it('shows an empty-state hint when the chatroom is empty for this swarm turn', () => {
    expect(src).toContain('No intra-agent messages recorded for this swarm turn.');
  });
});
