// Tool budget scaler tests — pure logic, no mocks needed.
// Issue: #153 discovery

import { describe, it, expect } from 'vitest';
import { computeToolBudget, PER_TOOL_TURN_CAPS, DEFAULT_PER_TOOL_TURN_CAP } from '../../src/orchestrator/toolBudgetScaler.js';

describe('toolBudgetScaler', () => {
  it('returns base budget for a normal message', () => {
    const result = computeToolBudget({
      userMessage: 'Send an email to Alice',
      historyLength: 0,
      domainCount: 1,
    });
    expect(result.budget).toBeGreaterThanOrEqual(5);
    expect(result.budget).toBeLessThanOrEqual(50);
  });

  it('caps at MIN_BUDGET for simple patterns', () => {
    const result = computeToolBudget({
      userMessage: 'show my inbox',
      historyLength: 50,
      domainCount: 5,
    });
    expect(result.budget).toBe(5);
    expect(result.adjustments.some(a => a.includes('Simple pattern'))).toBe(true);
  });

  it('list keyword triggers simple cap', () => {
    const result = computeToolBudget({
      userMessage: 'list my calendar events',
      historyLength: 0,
      domainCount: 1,
    });
    expect(result.budget).toBe(5);
  });

  it('increases budget for long history', () => {
    const short = computeToolBudget({ userMessage: 'do something', historyLength: 5, domainCount: 1 });
    const long = computeToolBudget({ userMessage: 'do something', historyLength: 25, domainCount: 1 });
    expect(long.budget).toBeGreaterThan(short.budget);
  });

  it('increases budget per domain count', () => {
    const one = computeToolBudget({ userMessage: 'do something', historyLength: 0, domainCount: 1 });
    const five = computeToolBudget({ userMessage: 'do something', historyLength: 0, domainCount: 5 });
    expect(five.budget).toBeGreaterThan(one.budget);
  });

  it('detects complex keywords and adds budget', () => {
    const result = computeToolBudget({
      userMessage: 'search and delete all old emails',
      historyLength: 0,
      domainCount: 1,
    });
    expect(result.adjustments.some(a => a.includes('Complex keywords'))).toBe(true);
  });

  it('never exceeds MAX_BUDGET (50)', () => {
    const result = computeToolBudget({
      userMessage: 'search and delete recursive batch for each',
      historyLength: 100,
      domainCount: 20,
    });
    expect(result.budget).toBeLessThanOrEqual(50);
  });

  it('never goes below MIN_BUDGET (5)', () => {
    const result = computeToolBudget({
      userMessage: 'x',
      historyLength: 0,
      domainCount: 0,
    });
    expect(result.budget).toBeGreaterThanOrEqual(5);
  });

  it('PER_TOOL_TURN_CAPS restricts high-frequency tools', () => {
    expect(PER_TOOL_TURN_CAPS['helkin_current_datetime']).toBe(1);
    expect(PER_TOOL_TURN_CAPS['web_search']).toBe(4);
    expect(PER_TOOL_TURN_CAPS['helkin_skill_search']).toBe(4);
  });

  it('DEFAULT_PER_TOOL_TURN_CAP is permissive but finite', () => {
    expect(DEFAULT_PER_TOOL_TURN_CAP).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_PER_TOOL_TURN_CAP).toBeLessThanOrEqual(20);
  });
});
