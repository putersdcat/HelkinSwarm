import { describe, expect, it } from 'vitest';
import {
  collectCompletedPlanStepOrders,
  resolveExecutionHint,
  selectReadyToolCallsByPlan,
  sortToolCallsByPlan,
} from '../../src/orchestrator/planExecutionHints.js';
import type { PlanStep } from '../../src/orchestrator/planActivity.js';

const planSteps: PlanStep[] = [
  {
    order: 2,
    description: 'Create the issue after gathering evidence',
    toolHint: 'github_create_issue',
    model: 'reasoning',
    useSubAgent: true,
    tokenScope: 'write',
    dependsOn: [1],
  },
  {
    order: 1,
    description: 'Search for the relevant emails first',
    toolHint: 'outlook_search_emails',
    model: 'fast',
    useSubAgent: true,
    tokenScope: 'read',
  },
];

describe('resolveExecutionHint', () => {
  it('uses plan hints to strengthen routing and preferred model', () => {
    const hint = resolveExecutionHint('github_create_issue', { requiresSubAgent: false }, planSteps);
    expect(hint.matchedPlanStep).toBe(true);
    expect(hint.stepOrder).toBe(2);
    expect(hint.preferredModel).toBe('reasoning');
    expect(hint.useSubAgent).toBe(true);
    expect(hint.tokenScope).toBe('write');
  });

  it('preserves manifest sub-agent routing even without a plan match', () => {
    const hint = resolveExecutionHint('outlook_read_email', { requiresSubAgent: true }, planSteps);
    expect(hint.matchedPlanStep).toBe(false);
    expect(hint.useSubAgent).toBe(true);
  });
});

describe('sortToolCallsByPlan', () => {
  it('reorders matched tool calls into plan order while keeping unmatched calls stable', () => {
    const sorted = sortToolCallsByPlan([
      { id: '2', name: 'github_create_issue', arguments: '{}' },
      { id: '1', name: 'outlook_search_emails', arguments: '{}' },
      { id: '3', name: 'helkin_health_check', arguments: '{}' },
    ], planSteps);

    expect(sorted.map((call) => call.name)).toEqual([
      'outlook_search_emails',
      'github_create_issue',
      'helkin_health_check',
    ]);
  });
});

describe('selectReadyToolCallsByPlan', () => {
  it('dispatches only the next ready planned step and defers later steps', () => {
    const batch = selectReadyToolCallsByPlan([
      { id: '2', name: 'github_create_issue', arguments: '{}' },
      { id: '1', name: 'outlook_search_emails', arguments: '{}' },
    ], planSteps, []);

    expect(batch.planConstrained).toBe(true);
    expect(batch.readyToolHints).toEqual(['outlook_search_emails']);
    expect(batch.selectedCalls.map((call) => call.name)).toEqual(['outlook_search_emails']);
    expect(batch.deferredCalls.map((call) => call.name)).toEqual(['github_create_issue']);
  });

  it('advances to the dependent step after the earlier step completes', () => {
    const batch = selectReadyToolCallsByPlan([
      { id: '2', name: 'github_create_issue', arguments: '{}' },
      { id: '1', name: 'outlook_search_emails', arguments: '{}' },
    ], planSteps, [1]);

    expect(batch.readyToolHints).toEqual(['github_create_issue']);
    expect(batch.selectedCalls.map((call) => call.name)).toEqual(['github_create_issue']);
  });
});

describe('collectCompletedPlanStepOrders', () => {
  it('marks matched successful tools complete in plan order', () => {
    const completed = collectCompletedPlanStepOrders([
      { toolName: 'outlook_search_emails', success: true },
    ], planSteps, []);

    expect(completed).toEqual([1]);
  });

  it('ignores failed executions and preserves already completed steps', () => {
    const completed = collectCompletedPlanStepOrders([
      { toolName: 'github_create_issue', success: false },
      { toolName: 'github_create_issue', success: true },
    ], planSteps, [1]);

    expect(completed).toEqual([1, 2]);
  });
});