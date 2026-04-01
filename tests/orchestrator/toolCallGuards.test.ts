import { describe, expect, it } from 'vitest';
import {
  buildToolCallFingerprint,
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

  it('treats non-read-only tools as mutating', () => {
    expect(isMutatingTool({ privilegeClass: 'create' })).toBe(true);
    expect(isMutatingTool({ privilegeClass: 'read-only' })).toBe(false);
    expect(isMutatingTool(undefined)).toBe(false);
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
});