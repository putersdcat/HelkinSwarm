import { describe, expect, it } from 'vitest';
import {
  canExecuteInMultiRound,
  getHighestMultiRoundRisk,
  shouldSkipConfirmationForMultiRound,
} from '../../src/orchestrator/multiRoundPolicy.js';

describe('multiRoundPolicy', () => {
  it('allows all non-executor tools to reach verification, including high-risk tools', () => {
    expect(canExecuteInMultiRound({ risk: 'low', requiresConfirmation: false, requiresExecutor: false })).toBe(true);
    expect(canExecuteInMultiRound({ risk: 'medium', requiresConfirmation: false, requiresExecutor: false })).toBe(true);
    expect(canExecuteInMultiRound({ risk: 'high', requiresConfirmation: false, requiresExecutor: false })).toBe(true);
    expect(canExecuteInMultiRound({ risk: 'high', requiresConfirmation: true, requiresExecutor: false })).toBe(true);
    expect(canExecuteInMultiRound({ risk: 'high', requiresConfirmation: false, requiresExecutor: true })).toBe(false);
  });

  it('computes the highest risk in a batch', () => {
    expect(getHighestMultiRoundRisk([{ risk: 'low' }, { risk: 'medium' }])).toBe('medium');
    expect(getHighestMultiRoundRisk([{ risk: 'low' }, { risk: 'high' }])).toBe('high');
    expect(getHighestMultiRoundRisk([{ risk: 'low' }])).toBe('low');
  });

  it('skips confirmation only when every tool in the batch explicitly skips it', () => {
    expect(shouldSkipConfirmationForMultiRound([
      { risk: 'high', requiresConfirmation: false },
      { risk: 'medium', requiresConfirmation: false },
    ])).toBe(true);
    expect(shouldSkipConfirmationForMultiRound([
      { risk: 'high', requiresConfirmation: false },
      { risk: 'high', requiresConfirmation: true },
    ])).toBe(false);
  });
});