import { describe, expect, it } from 'vitest';
import {
  detectClarificationRequest,
  resolveClarificationAnswer,
} from '../../src/orchestrator/clarificationLoop.js';

describe('clarificationLoop', () => {
  it('requests a clarification when a calendar create request has a date but no time', () => {
    const result = detectClarificationRequest(
      'please put lunch with a friend on my calendar tomorrow',
      new Date('2026-03-30T12:00:00Z'),
      'secondary',
    );

    expect(result).toBeDefined();
    expect(result?.pending.reason).toBe('missing_calendar_time');
    expect(result?.pending.modelOverride).toBe('secondary');
    expect(result?.responseMessage).toContain('what time should I put it on your calendar');
  });

  it('does not request clarification when the original calendar request already contains a time', () => {
    const result = detectClarificationRequest(
      'please put lunch with a friend on my calendar tomorrow at 12:30 PM',
      new Date('2026-03-30T12:00:00Z'),
    );

    expect(result).toBeUndefined();
  });

  it('asks again when the clarification answer still lacks a usable time', () => {
    const pending = detectClarificationRequest(
      'please put lunch with a friend on my calendar tomorrow',
      new Date('2026-03-30T12:00:00Z'),
    )!.pending;

    const result = resolveClarificationAnswer(
      pending,
      'sometime after lunch',
      new Date('2026-03-30T12:02:00Z'),
    );

    expect(result.kind).toBe('retry');
    if (result.kind === 'retry') {
      expect(result.responseMessage).toContain('still missing the time');
      expect(result.pending.id).toBe(pending.id);
    }
  });

  it('resumes the original request when the user provides a time', () => {
    const pending = detectClarificationRequest(
      'please put lunch with a friend on my calendar tomorrow',
      new Date('2026-03-30T12:00:00Z'),
      'secondary',
    )!.pending;

    const result = resolveClarificationAnswer(
      pending,
      '12:30 PM',
      new Date('2026-03-30T12:02:00Z'),
    );

    expect(result.kind).toBe('resume');
    if (result.kind === 'resume') {
      expect(result.resumedUserMessage).toContain(pending.originalUserMessage);
      expect(result.resumedUserMessage).toContain('Clarification answer from the user: 12:30 PM');
      expect(result.resumedUserMessage).toContain('Do not ask for the same time again');
    }
  });

  it('cancels or expires cleanly instead of resuming stale clarification state', () => {
    const pending = detectClarificationRequest(
      'please put lunch with a friend on my calendar tomorrow',
      new Date('2026-03-30T12:00:00Z'),
    )!.pending;

    const cancelled = resolveClarificationAnswer(
      pending,
      'cancel',
      new Date('2026-03-30T12:01:00Z'),
    );
    expect(cancelled.kind).toBe('cancelled');

    const expired = resolveClarificationAnswer(
      pending,
      '12:30 PM',
      new Date('2026-03-30T12:11:00Z'),
    );
    expect(expired.kind).toBe('expired');
  });
});