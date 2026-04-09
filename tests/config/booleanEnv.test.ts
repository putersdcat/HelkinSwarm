import { describe, expect, it } from 'vitest';
import { parseBooleanEnv } from '../../src/config/booleanEnv.js';

describe('parseBooleanEnv', () => {
  it('treats explicit false-like strings as disabled', () => {
    expect(parseBooleanEnv(undefined)).toBe(false);
    expect(parseBooleanEnv('')).toBe(false);
    expect(parseBooleanEnv('false')).toBe(false);
    expect(parseBooleanEnv('0')).toBe(false);
    expect(parseBooleanEnv('off')).toBe(false);
  });

  it('treats true-like strings as enabled', () => {
    expect(parseBooleanEnv('true')).toBe(true);
    expect(parseBooleanEnv('1')).toBe(true);
    expect(parseBooleanEnv('yes')).toBe(true);
    expect(parseBooleanEnv('on')).toBe(true);
  });
});