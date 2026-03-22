// DevLoop session context builder tests — pure logic.

import { describe, it, expect } from 'vitest';
import { buildDevLoopSystemBlock } from '../../src/devloop/sessionContext.js';
import type { DevLoopContext } from '../../src/devloop/radioProtocol.js';

function makeContext(overrides: Partial<DevLoopContext> = {}): DevLoopContext {
  return {
    isDevLoop: false,
    prefix: undefined,
    correlationTag: undefined,
    hasOverTerminator: false,
    rawBody: '',
    ...overrides,
  };
}

describe('buildDevLoopSystemBlock', () => {
  it('returns empty string for non-DevLoop messages', () => {
    expect(buildDevLoopSystemBlock(makeContext())).toBe('');
  });

  it('includes DevLoop session header for DevLoop messages', () => {
    const result = buildDevLoopSystemBlock(makeContext({ isDevLoop: true, prefix: 'DEVLOOP' }));
    expect(result).toContain('[DevLoop Session Active]');
    expect(result).toContain('bidirectional development session');
  });

  it('includes correlation tag when present', () => {
    const result = buildDevLoopSystemBlock(
      makeContext({ isDevLoop: true, prefix: 'DEVLOOP', correlationTag: '[DL-TEST-001]' }),
    );
    expect(result).toContain('[DL-TEST-001]');
  });

  it('includes interrogation note for DEVQUERY prefix', () => {
    const result = buildDevLoopSystemBlock(makeContext({ isDevLoop: true, prefix: 'DEVQUERY' }));
    expect(result).toContain('DEVQUERY');
    expect(result).toContain('interrogation request');
  });

  it('does not include interrogation note for DEVLOOP prefix', () => {
    const result = buildDevLoopSystemBlock(makeContext({ isDevLoop: true, prefix: 'DEVLOOP' }));
    expect(result).not.toContain('interrogation request');
  });
});
