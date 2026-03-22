// Radio protocol parser tests — pure logic, no mocks needed.
// Issue: #153 discovery

import { describe, it, expect } from 'vitest';
import { parseDevLoopMessage, toDevLoopContext, DEVLOOP_PROTOCOL_VERSION } from '../../src/devloop/radioProtocol.js';

describe('radioProtocol', () => {
  it('parses a standard DEVLOOP message', () => {
    const msg = parseDevLoopMessage('DEVLOOP: [DL-20260322070000-A7F2] health check OVER');
    expect(msg.isDevLoop).toBe(true);
    expect(msg.prefix).toBe('DEVLOOP');
    expect(msg.correlationTag).toBe('[DL-20260322070000-A7F2]');
    expect(msg.body).toBe('health check');
    expect(msg.hasOver).toBe(true);
  });

  it('parses SWARM response', () => {
    const msg = parseDevLoopMessage('SWARM: All systems nominal [DL-20260322-X] OVER');
    expect(msg.isDevLoop).toBe(true);
    expect(msg.prefix).toBe('SWARM');
    expect(msg.correlationTag).toBe('[DL-20260322-X]');
    expect(msg.body).toBe('All systems nominal');
    expect(msg.hasOver).toBe(true);
  });

  it('parses DEVQUERY prefix', () => {
    const msg = parseDevLoopMessage('DEVQUERY: what tools are registered? OVER');
    expect(msg.prefix).toBe('DEVQUERY');
    expect(msg.body).toBe('what tools are registered?');
  });

  it('parses HELKIN-REPLY prefix', () => {
    const msg = parseDevLoopMessage('HELKIN-REPLY: here are the results OVER');
    expect(msg.prefix).toBe('HELKIN-REPLY');
  });

  it('parses SWARM-TOOL-REPORT prefix', () => {
    const msg = parseDevLoopMessage('SWARM-TOOL-REPORT: tools ok OVER');
    expect(msg.prefix).toBe('SWARM-TOOL-REPORT');
  });

  it('handles message without OVER', () => {
    const msg = parseDevLoopMessage('DEVLOOP: [DL-123] no over here');
    expect(msg.hasOver).toBe(false);
    expect(msg.body).toBe('no over here');
  });

  it('returns isDevLoop=false for regular messages', () => {
    const msg = parseDevLoopMessage('Hey, what is the weather?');
    expect(msg.isDevLoop).toBe(false);
    expect(msg.prefix).toBeNull();
    expect(msg.correlationTag).toBeNull();
    expect(msg.body).toBe('Hey, what is the weather?');
  });

  it('handles probe-style correlation tags', () => {
    const msg = parseDevLoopMessage('DEVLOOP: [probe-1234] test OVER');
    expect(msg.correlationTag).toBe('[probe-1234]');
  });

  it('preserves raw field', () => {
    const raw = 'DEVLOOP: [DL-X] hello OVER';
    const msg = parseDevLoopMessage(raw);
    expect(msg.raw).toBe(raw);
  });

  it('case-insensitive prefix detection', () => {
    const msg = parseDevLoopMessage('devloop: hello OVER');
    expect(msg.isDevLoop).toBe(true);
    expect(msg.prefix).toBe('DEVLOOP');
  });
});

describe('toDevLoopContext', () => {
  it('returns context for DevLoop messages', () => {
    const msg = parseDevLoopMessage('DEVLOOP: [DL-X] test OVER');
    const ctx = toDevLoopContext(msg);
    expect(ctx).toBeDefined();
    expect(ctx!.prefix).toBe('DEVLOOP');
    expect(ctx!.correlationTag).toBe('[DL-X]');
  });

  it('returns undefined for non-DevLoop messages', () => {
    const msg = parseDevLoopMessage('hello world');
    expect(toDevLoopContext(msg)).toBeUndefined();
  });
});

describe('protocol version', () => {
  it('is 1.0.0', () => {
    expect(DEVLOOP_PROTOCOL_VERSION).toBe('1.0.0');
  });
});
