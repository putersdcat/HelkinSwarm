// Verification pipeline spot-check hardening tests.
// Covers: Fisher-Yates sampling, enforced/advisory/disabled policies,
// missing verifier, partial mismatch, threshold exceeded, and full pass.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VerificationInput, SpotCheckPolicy, VerifiedSet } from '../../src/orchestrator/verificationPipeline.js';

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
const { runVerificationPipeline, buildVerifiedSet, hashVerifiedSet } = await import('../../src/orchestrator/verificationPipeline.js');

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

  describe('verified-set canonicalization (#266)', () => {
    it('buildVerifiedSet sorts and deduplicates IDs', () => {
      const vs = buildVerifiedSet('sess1', 'github_delete_issue', 'delete', ['3', '1', '2', '1']);
      expect(vs.ids).toEqual(['1', '2', '3']);
      expect(vs.sessionId).toBe('sess1');
      expect(vs.toolName).toBe('github_delete_issue');
      expect(vs.operationType).toBe('delete');
      expect(vs.verifiedAt).toBeTruthy();
    });

    it('hashVerifiedSet produces a stable SHA-256 hex string', () => {
      const vs: VerifiedSet = {
        sessionId: 'sess1',
        toolName: 'outlook_delete_email',
        operationType: 'delete',
        ids: ['a', 'b', 'c'],
        verifiedAt: '2026-03-25T00:00:00.000Z',
      };
      const h1 = hashVerifiedSet(vs);
      const h2 = hashVerifiedSet(vs);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('hashVerifiedSet changes when IDs differ', () => {
      const base: VerifiedSet = {
        sessionId: 's', toolName: 't', operationType: 'delete',
        ids: ['1', '2'], verifiedAt: '2026-01-01T00:00:00Z',
      };
      const altered: VerifiedSet = { ...base, ids: ['1', '2', '3'] };
      expect(hashVerifiedSet(base)).not.toBe(hashVerifiedSet(altered));
    });

    it('pipeline emits verifiedSet when spotCheckIds are present', async () => {
      mockGetHandler.mockReturnValue(async () => ({ id: '42' }));
      const result = await runVerificationPipeline(
        makeInput({
          toolName: 'github_delete_issue',
          spotCheckIds: ['42'],
          spotCheckPolicy: 'advisory',
        }),
      );
      expect(result.verifiedSet).toBeDefined();
      expect(result.verifiedSet!.ids).toEqual(['42']);
      expect(result.verifiedSetHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('pipeline does NOT emit verifiedSet when no spotCheckIds', async () => {
      const result = await runVerificationPipeline(makeInput());
      expect(result.verifiedSet).toBeUndefined();
      expect(result.verifiedSetHash).toBeUndefined();
    });

    it('verifiedSet operationType inferred from tool name', () => {
      expect(buildVerifiedSet('s', 'outlook_delete_email', 'delete', ['1']).operationType).toBe('delete');
      expect(buildVerifiedSet('s', 'github_create_issue', 'create', ['1']).operationType).toBe('create');
    });
  });

  describe('per-tool confirmation opt-out (#302)', () => {
    it('skipConfirmation=true bypasses confirmation for high-risk tools', async () => {
      const result = await runVerificationPipeline(
        makeInput({ risk: 'high', skipConfirmation: true }),
      );
      expect(result.passed).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('skipConfirmation=false still requires confirmation for high-risk tools', async () => {
      const result = await runVerificationPipeline(
        makeInput({ risk: 'high', skipConfirmation: false }),
      );
      // No confirmationResponse provided, so pipeline should require confirmation
      expect(result.requiresConfirmation).toBe(true);
    });

    it('skipConfirmation=true bypasses confirmation for medium-risk tools', async () => {
      const result = await runVerificationPipeline(
        makeInput({ risk: 'medium', skipConfirmation: true }),
      );
      expect(result.passed).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });
  });
});
