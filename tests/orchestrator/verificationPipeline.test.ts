// Verification pipeline spot-check hardening tests.
// Covers: Fisher-Yates sampling, enforced/advisory/disabled policies,
// missing verifier, partial mismatch, threshold exceeded, and full pass.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VerificationInput, SpotCheckPolicy } from '../../src/orchestrator/verificationPipeline.js';

// ---------------------------------------------------------------------------
// Mocks — we mock heavy dependencies so we're testing spot-check logic only
// ---------------------------------------------------------------------------

vi.mock('../../src/config/safetyConfig.js', () => ({
  safetyConfig: {
    safetyMode: 'confirmation-gated',
    spotCheckSampleSize: 3,
    spotCheckVerifyAllThreshold: 5,
    confirmationTimeoutSeconds: 300,
  },
  isConfirmationGated: () => true,
  isReadOnly: () => false,
}));

vi.mock('../../src/llm/promptShields.js', () => ({
  promptShields: {
    check: async () => ({ clean: true, categories: {} }),
  },
}));

vi.mock('../../src/tools/toolRegistry.js', () => ({
  toolRegistry: {
    get: () => undefined,
  },
}));

// Mock capabilityLoader used by domain verifiers
const mockGetHandler = vi.fn().mockReturnValue(undefined);
vi.mock('../../src/capabilities/capabilityLoader.js', () => ({
  getHandler: (...args: unknown[]) => mockGetHandler(...args),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
const { runVerificationPipeline } = await import('../../src/orchestrator/verificationPipeline.js');

function makeInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    correlationId: 'test-corr-001',
    sessionId: 'test-session',
    userId: 'test-user',
    toolName: 'some_unknown_tool',
    risk: 'low',
    rawOutput: 'test output',
    originalQuery: 'test query',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('spot-check verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('policy: disabled', () => {
    it('skips spot-check entirely', async () => {
      const result = await runVerificationPipeline(
        makeInput({
          spotCheckIds: ['id1', 'id2'],
          spotCheckPolicy: 'disabled',
        }),
      );
      expect(result.passed).toBe(true);
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.passed).toBe(true);
      expect(spotStep?.spotCheckDetails?.outcome).toBe('no-check-required');
    });
  });

  describe('no IDs to check', () => {
    it('passes with no-check-required outcome', async () => {
      const result = await runVerificationPipeline(
        makeInput({ spotCheckIds: [], spotCheckPolicy: 'enforced' }),
      );
      expect(result.passed).toBe(true);
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.passed).toBe(true);
      expect(spotStep?.spotCheckDetails?.outcome).toBe('no-check-required');
      expect(spotStep?.spotCheckDetails?.totalIds).toBe(0);
    });

    it('passes when spotCheckIds is undefined', async () => {
      const result = await runVerificationPipeline(makeInput());
      expect(result.passed).toBe(true);
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.passed).toBe(true);
    });
  });

  describe('missing verifier', () => {
    it('passes through with advisory policy (default)', async () => {
      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'some_unknown_tool',
          spotCheckIds: ['id1', 'id2'],
        }),
      );
      expect(result.passed).toBe(true);
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.passed).toBe(true);
      expect(spotStep?.spotCheckDetails?.outcome).toBe('verifier-missing');
    });

    it('fails closed with enforced policy', async () => {
      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'some_unknown_tool',
          spotCheckIds: ['id1', 'id2'],
          spotCheckPolicy: 'enforced',
        }),
      );
      expect(result.passed).toBe(false);
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.passed).toBe(false);
      expect(spotStep?.spotCheckDetails?.outcome).toBe('verifier-missing');
      expect(result.error).toContain('Spot-check failed');
    });
  });

  describe('domain verifier with mismatches (github_)', () => {
    it('advisory policy: pipeline passes despite mismatches', async () => {
      // github verifier calls getHandler('github_get_issue') — make it return an error
      mockGetHandler.mockImplementation((name: string) => {
        if (name === 'github_get_issue') {
          return async () => ({ error: 'not found' });
        }
        return undefined;
      });

      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'github_list_issues',
          spotCheckIds: ['1', '2', '3'],
          spotCheckPolicy: 'advisory',
        }),
      );
      expect(result.passed).toBe(true);
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.passed).toBe(true); // advisory doesn't hard-fail
      expect(spotStep?.spotCheckDetails?.outcome).toBe('threshold-exceeded');
      expect(spotStep?.spotCheckDetails?.mismatchedIds.length).toBeGreaterThan(0);
      expect(spotStep?.spotCheckDetails?.verifierUsed).toBe('github');
    });

    it('enforced policy: pipeline fails on mismatches', async () => {
      mockGetHandler.mockImplementation((name: string) => {
        if (name === 'github_get_issue') {
          return async () => ({ error: 'not found' });
        }
        return undefined;
      });

      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'github_list_issues',
          spotCheckIds: ['1', '2'],
          spotCheckPolicy: 'enforced',
        }),
      );
      expect(result.passed).toBe(false);
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.passed).toBe(false);
      expect(spotStep?.spotCheckDetails?.outcome).toBe('threshold-exceeded');
      expect(result.error).toContain('Spot-check failed');
    });
  });

  describe('domain verifier full pass (github_)', () => {
    it('passes when all IDs verify successfully', async () => {
      mockGetHandler.mockImplementation((name: string) => {
        if (name === 'github_get_issue') {
          return async () => ({ id: 1, title: 'some issue' });
        }
        return undefined;
      });

      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'github_list_issues',
          spotCheckIds: ['1', '2', '3'],
          spotCheckPolicy: 'enforced',
        }),
      );
      expect(result.passed).toBe(true);
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.passed).toBe(true);
      expect(spotStep?.spotCheckDetails?.outcome).toBe('verify-all-passed');
      expect(spotStep?.spotCheckDetails?.sampledCount).toBe(3);
      expect(spotStep?.spotCheckDetails?.matchedCount).toBe(3);
      expect(spotStep?.spotCheckDetails?.mismatchedIds).toEqual([]);
    });
  });

  describe('sampling behavior', () => {
    it('verify-all when IDs <= threshold (5)', async () => {
      mockGetHandler.mockImplementation((name: string) => {
        if (name === 'github_get_issue') {
          return async () => ({ id: 1 });
        }
        return undefined;
      });

      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'github_list_issues',
          spotCheckIds: ['1', '2', '3', '4', '5'],
          spotCheckPolicy: 'enforced',
        }),
      );
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.spotCheckDetails?.outcome).toBe('verify-all-passed');
      expect(spotStep?.spotCheckDetails?.sampledCount).toBe(5);
      expect(spotStep?.spotCheckDetails?.totalIds).toBe(5);
    });

    it('samples when IDs > threshold', async () => {
      mockGetHandler.mockImplementation((name: string) => {
        if (name === 'github_get_issue') {
          return async () => ({ id: 1 });
        }
        return undefined;
      });

      const ids = Array.from({ length: 20 }, (_, i) => String(i + 1));
      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'github_list_issues',
          spotCheckIds: ids,
          spotCheckPolicy: 'enforced',
        }),
      );
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.spotCheckDetails?.outcome).toBe('sample-verified');
      expect(spotStep?.spotCheckDetails?.sampledCount).toBe(3); // sampleSize = 3
      expect(spotStep?.spotCheckDetails?.totalIds).toBe(20);
    });
  });

  describe('verifier error handling', () => {
    it('advisory: passes on verifier error', async () => {
      mockGetHandler.mockImplementation((name: string) => {
        if (name === 'github_get_issue') {
          return async () => { throw new Error('API unavailable'); };
        }
        return undefined;
      });

      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'github_list_issues',
          spotCheckIds: ['1'],
          spotCheckPolicy: 'advisory',
        }),
      );
      expect(result.passed).toBe(true);
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      // verifier throws → individual ID failure, which is threshold-exceeded
      expect(spotStep?.passed).toBe(true);
    });

    it('enforced: fails on verifier error', async () => {
      mockGetHandler.mockImplementation((name: string) => {
        if (name === 'github_get_issue') {
          return async () => { throw new Error('API unavailable'); };
        }
        return undefined;
      });

      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'github_list_issues',
          spotCheckIds: ['1'],
          spotCheckPolicy: 'enforced',
        }),
      );
      expect(result.passed).toBe(false);
    });
  });

  describe('telemetry structure', () => {
    it('includes spotCheckDetails on every spot-check step', async () => {
      const result = await runVerificationPipeline(
        makeInput({ spotCheckIds: ['id1'], spotCheckPolicy: 'advisory' }),
      );
      const spotStep = result.steps.find(s => s.step === 'spot-check');
      expect(spotStep?.spotCheckDetails).toBeDefined();
      expect(spotStep?.spotCheckDetails).toHaveProperty('outcome');
      expect(spotStep?.spotCheckDetails).toHaveProperty('sampledCount');
      expect(spotStep?.spotCheckDetails).toHaveProperty('matchedCount');
      expect(spotStep?.spotCheckDetails).toHaveProperty('mismatchedIds');
      expect(spotStep?.spotCheckDetails).toHaveProperty('verifierUsed');
      expect(spotStep?.spotCheckDetails).toHaveProperty('totalIds');
    });
  });
});
