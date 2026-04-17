// #670 — freshness gate on shouldAutoReplay so stale queued intents stop
// replaying across deploy restarts after the operator has moved on.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldAutoReplay } from '../../src/orchestrator/pendingIntentReplay.js';
import type { PendingIntent } from '../../src/orchestrator/pendingIntentStore.js';

function buildIntent(overrides: Partial<PendingIntent> = {}): PendingIntent {
  const base: PendingIntent = {
    id: 'intent-1',
    userId: 'user-1',
    trackingId: 'PI-TEST',
    idempotencyKey: 'user-1:1:hello',
    status: 'received',
    timestamp: new Date().toISOString(),
    messageText: 'hello',
    riskLevel: 'low',
    correlationId: 'corr-1',
    imageUrls: [],
    runtimeAssets: [],
    attachmentNotices: [],
  } as PendingIntent;
  return { ...base, ...overrides };
}

describe('shouldAutoReplay — #670 freshness gate', () => {
  const originalMaxAge = process.env.PENDING_INTENT_MAX_AGE_HOURS;

  beforeEach(() => {
    delete process.env.PENDING_INTENT_MAX_AGE_HOURS;
  });

  afterEach(() => {
    if (originalMaxAge === undefined) {
      delete process.env.PENDING_INTENT_MAX_AGE_HOURS;
    } else {
      process.env.PENDING_INTENT_MAX_AGE_HOURS = originalMaxAge;
    }
  });

  it('allows replay for a fresh, low-risk intent', () => {
    const now = Date.now();
    const intent = buildIntent({ timestamp: new Date(now - 5 * 60_000).toISOString() });
    const decision = shouldAutoReplay(intent, now);
    expect(decision.replay).toBe(true);
  });

  it('blocks replay when intent is older than the default 2h cutoff', () => {
    const now = Date.now();
    const intent = buildIntent({ timestamp: new Date(now - 3 * 60 * 60_000).toISOString() });
    const decision = shouldAutoReplay(intent, now);
    expect(decision.replay).toBe(false);
    expect(decision.reason).toMatch(/expired/i);
  });

  it('honors PENDING_INTENT_MAX_AGE_HOURS override', () => {
    process.env.PENDING_INTENT_MAX_AGE_HOURS = '0.5';
    const now = Date.now();
    const intent = buildIntent({ timestamp: new Date(now - 45 * 60_000).toISOString() });
    const decision = shouldAutoReplay(intent, now);
    expect(decision.replay).toBe(false);
    expect(decision.reason).toContain('0.5h');
  });

  it('disables age gating entirely when PENDING_INTENT_MAX_AGE_HOURS=0', () => {
    process.env.PENDING_INTENT_MAX_AGE_HOURS = '0';
    const now = Date.now();
    const intent = buildIntent({ timestamp: new Date(now - 999 * 60 * 60_000).toISOString() });
    const decision = shouldAutoReplay(intent, now);
    expect(decision.replay).toBe(true);
  });

  it('preserves the existing high-risk skip reason', () => {
    const intent = buildIntent({ riskLevel: 'high' });
    const decision = shouldAutoReplay(intent);
    expect(decision.replay).toBe(false);
    expect(decision.reason).toMatch(/High-risk/);
  });
});
