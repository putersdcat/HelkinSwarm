// Ack variants + spinner tests — pure logic, no mocks.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAckVariant,
  getCorrelatedAck,
  getCorrelatedSpinnerAck,
  nextSpinnerFrame,
  resetSpinner,
  getSpinnerAck,
} from '../../src/bot/ackVariants.js';

describe('getAckVariant', () => {
  it('returns a string starting with ⌛', () => {
    const result = getAckVariant();
    expect(result).toMatch(/^⌛/);
  });

  it('does not repeat the same variant consecutively', () => {
    const first = getAckVariant();
    let hadDifferent = false;
    for (let i = 0; i < 20; i++) {
      const next = getAckVariant();
      if (next !== first) hadDifferent = true;
    }
    expect(hadDifferent).toBe(true);
  });
});

describe('spinner', () => {
  beforeEach(() => {
    resetSpinner();
  });

  it('returns Braille frames in sequence', () => {
    const first = nextSpinnerFrame();
    const second = nextSpinnerFrame();
    expect(first).toBe('⠋');
    expect(second).toBe('⠙');
  });

  it('cycles back to first frame', () => {
    for (let i = 0; i < 9; i++) nextSpinnerFrame(); // exhaust all 9
    expect(nextSpinnerFrame()).toBe('⠋'); // wraps around
  });

  it('getSpinnerAck returns frame + message', () => {
    const ack = getSpinnerAck('Working...');
    expect(ack).toBe('⠋ Working...');
  });

  it('getSpinnerAck defaults to Processing...', () => {
    const ack = getSpinnerAck();
    expect(ack).toBe('⠋ Processing...');
  });
});

describe('getCorrelatedAck', () => {
  it('includes the correlation tag in backticks', () => {
    const result = getCorrelatedAck('abcd1234');
    expect(result).toContain('`[corr:abcd1234]`');
  });

  it('starts with the ⌛ ack variant', () => {
    const result = getCorrelatedAck('deadbeef');
    expect(result).toMatch(/^⌛/);
  });
});

describe('getCorrelatedSpinnerAck', () => {
  beforeEach(() => {
    resetSpinner();
  });

  it('includes spinner frame, message, and correlation tag', () => {
    const result = getCorrelatedSpinnerAck('abcd1234');
    expect(result).toBe('⠋ Still thinking... `[corr:abcd1234]`');
  });

  it('accepts a custom base message', () => {
    const result = getCorrelatedSpinnerAck('abcd1234', 'Working hard...');
    expect(result).toBe('⠋ Working hard... `[corr:abcd1234]`');
  });

  it('advances spinner frame on each call', () => {
    const first = getCorrelatedSpinnerAck('tag1');
    const second = getCorrelatedSpinnerAck('tag1');
    expect(first).toMatch(/^⠋/);
    expect(second).toMatch(/^⠙/);
  });
});
