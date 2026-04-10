import { describe, expect, it } from 'vitest';
import {
  buildDuplicateReplayedToolResult,
  buildToolCallFingerprint,
  isReplayableReadOnlyTool,
  recordSuccessfulReplayableReadOnlyResults,
  isMutatingTool,
  recordSuccessfulMutatingFingerprints,
} from '../../src/orchestrator/toolCallGuards.js';

describe('toolCallGuards', () => {
  it('builds a stable fingerprint regardless of JSON key order', () => {
    const a = buildToolCallFingerprint('outlook_send_email', '{"subject":"Hello","to":["eric@example.com"],"body":"hi"}');
    const b = buildToolCallFingerprint('outlook_send_email', '{"body":"hi","to":["eric@example.com"],"subject":"Hello"}');

    expect(a).toBe(b);
  });

  it('normalizes outlook_send_email defaults and ordering when fingerprinting semantically identical sends', () => {
    const minimal = buildToolCallFingerprint(
      'outlook_send_email',
      '{"to":["eric@eanderson.de"],"subject":"Hello","body":"Hi there"}',
    );
    const explicitDefaults = buildToolCallFingerprint(
      'outlook_send_email',
      '{"body":"Hi there","subject":"Hello","cc":[],"inlineAssets":[],"to":["eric@eanderson.de"],"attachmentAssetIds":[],"bodyType":"text"}',
    );

    expect(minimal).toBe(explicitDefaults);
  });

  it('normalizes outlook_list_emails defaults and filter formatting when fingerprinting semantically identical reads', () => {
    const minimal = buildToolCallFingerprint(
      'outlook_list_emails',
      '{"top":5,"filter":"isRead eq false"}',
    );
    const explicitDefaults = buildToolCallFingerprint(
      'outlook_list_emails',
      '{"filter":"  isRead   eq   false  ","folder":"Inbox","top":5}',
    );

    expect(minimal).toBe(explicitDefaults);
  });

  it('treats non-read-only tools as mutating', () => {
    expect(isMutatingTool({ privilegeClass: 'create' })).toBe(true);
    expect(isMutatingTool({ privilegeClass: 'read-only' })).toBe(false);
    expect(isMutatingTool(undefined)).toBe(false);
  });

  it('treats read-only tools as replayable within the same turn', () => {
    expect(isReplayableReadOnlyTool({ privilegeClass: 'read-only' })).toBe(true);
    expect(isReplayableReadOnlyTool({ privilegeClass: 'create' })).toBe(false);
    expect(isReplayableReadOnlyTool(undefined)).toBe(false);
  });

  it('records successful mutating tool fingerprints only for successful non-read-only calls', () => {
    const target = new Set<string>();

    recordSuccessfulMutatingFingerprints(
      [
        { id: '1', name: 'outlook_send_email', arguments: '{"subject":"Hello"}' },
        { id: '2', name: 'outlook_list_emails', arguments: '{"top":1}' },
        { id: '3', name: 'outlook_send_email', arguments: '{"subject":"Failing send"}' },
      ],
      [
        { toolCallId: '1', toolName: 'outlook_send_email', success: true },
        { toolCallId: '2', toolName: 'outlook_list_emails', success: true },
        { toolCallId: '3', toolName: 'outlook_send_email', success: false },
      ],
      (toolName) => toolName === 'outlook_send_email'
        ? { privilegeClass: 'create' }
        : { privilegeClass: 'read-only' },
      target,
    );

    expect(target.size).toBe(1);
    expect(Array.from(target)[0]).toContain('outlook_send_email');
    expect(Array.from(target)[0]).toContain('Hello');
  });

  it('records successful replayable read-only results and skips mutating ones', () => {
    const target = new Map<string, { toolCallId: string; toolName: string; success: boolean; result?: unknown }>();

    recordSuccessfulReplayableReadOnlyResults(
      [
        { id: '1', name: 'outlook_list_emails', arguments: '{"top":5,"filter":"isRead eq false"}' },
        { id: '2', name: 'outlook_send_email', arguments: '{"subject":"Hello"}' },
      ],
      [
        { toolCallId: '1', toolName: 'outlook_list_emails', success: true, result: [{ id: 'm1', subject: 'Hello' }] },
        { toolCallId: '2', toolName: 'outlook_send_email', success: true, result: { success: true } },
      ],
      (toolName) => toolName === 'outlook_list_emails'
        ? { privilegeClass: 'read-only' }
        : { privilegeClass: 'create' },
      target,
    );

    expect(target.size).toBe(1);
    expect(Array.from(target.keys())[0]).toContain('outlook_list_emails');
    expect(target.values().next().value?.result).toEqual([{ id: 'm1', subject: 'Hello' }]);
  });

  it('replays the previous successful read-only result for a duplicate call', () => {
    const replayed = buildDuplicateReplayedToolResult(
      { id: '2', name: 'outlook_list_emails', arguments: '{"top":5}' },
      {
        toolCallId: '1',
        toolName: 'outlook_list_emails',
        success: true,
        result: [{ id: 'm1', subject: 'Hello' }],
        requiresExecutor: false,
      },
    );

    expect(replayed).toEqual({
      toolCallId: '2',
      toolName: 'outlook_list_emails',
      success: true,
      result: [{ id: 'm1', subject: 'Hello' }],
      requiresExecutor: false,
    });
  });
});