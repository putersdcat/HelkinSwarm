// Tests for helkin_get_openrouter_spend tool handler
// Issue: #612

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { helkin_get_openrouter_spend } from '../../skills/core/handlers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_KEY_RESPONSE = {
  data: {
    label: 'sk-or-v1-abc...123',
    is_management_key: false,
    limit: 25,
    limit_remaining: 24.5,
    usage: 0.5,
    usage_daily: 0.05,
    usage_weekly: 0.25,
    usage_monthly: 0.5,
    is_free_tier: false,
    expires_at: '2026-05-02T18:00:06.56+02:00',
  },
};

const MOCK_KEY_RESPONSE_NO_LIMIT = {
  data: {
    label: 'sk-or-v1-abc...123',
    limit: null,
    limit_remaining: null,
    usage: 1.234,
    usage_daily: 0.1,
    usage_weekly: 0.5,
    usage_monthly: 1.234,
    is_free_tier: false,
    expires_at: null,
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env['OPENROUTER_API_KEY'] = 'test-api-key';
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('helkin_get_openrouter_spend', () => {
  describe('happy path', () => {
    it('returns parsed spend data with limit', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_KEY_RESPONSE,
      } as Response);

      const result = await helkin_get_openrouter_spend({}) as Record<string, unknown>;

      expect(result['status']).toBe('success');
      expect(result['provider']).toBe('openrouter');
      expect(result['usageMonthlyUsd']).toBe(0.5);
      expect(result['usageDailyUsd']).toBe(0.05);
      expect(result['usageWeeklyUsd']).toBe(0.25);
      expect(result['totalUsageUsd']).toBe(0.5);
      expect(result['limitUsd']).toBe(25);
      expect(result['remainingUsd']).toBe(24.5);
      expect(result['isFreeTier']).toBe(false);
      expect(result['label']).toBe('sk-or-v1-abc...123');
    });

    it('constructs summary string with limit', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_KEY_RESPONSE,
      } as Response);

      const result = await helkin_get_openrouter_spend({}) as Record<string, unknown>;

      expect(typeof result['summary']).toBe('string');
      expect(result['summary'] as string).toContain('OpenRouter:');
      expect(result['summary'] as string).toContain('$25.00 limit');
    });

    it('calls the correct OpenRouter endpoint with Bearer auth', async () => {
      const fetchMock = vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_KEY_RESPONSE,
      } as Response);

      await helkin_get_openrouter_spend({});

      expect(fetchMock).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/auth/key',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('handles no-limit key gracefully', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_KEY_RESPONSE_NO_LIMIT,
      } as Response);

      const result = await helkin_get_openrouter_spend({}) as Record<string, unknown>;

      expect(result['status']).toBe('success');
      expect(result['limitUsd']).toBeNull();
      expect(result['remainingUsd']).toBeNull();
      expect(result['summary'] as string).toContain('no limit set');
    });

    it('handles null expires_at', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_KEY_RESPONSE_NO_LIMIT,
      } as Response);

      const result = await helkin_get_openrouter_spend({}) as Record<string, unknown>;

      expect(result['expiresAt']).toBeNull();
    });
  });

  describe('error paths', () => {
    it('returns unavailable when OPENROUTER_API_KEY not set', async () => {
      delete process.env['OPENROUTER_API_KEY'];

      const result = await helkin_get_openrouter_spend({}) as Record<string, unknown>;

      expect(result['status']).toBe('unavailable');
      expect(result['message']).toContain('OPENROUTER_API_KEY not configured');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns error on non-OK HTTP response', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      const result = await helkin_get_openrouter_spend({}) as Record<string, unknown>;

      expect(result['status']).toBe('error');
      expect(result['message']).toContain('401');
    });

    it('returns error on malformed API response', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ wrong: 'shape' }),
      } as Response);

      const result = await helkin_get_openrouter_spend({}) as Record<string, unknown>;

      expect(result['status']).toBe('error');
      expect(result['message']).toContain('parsing failed');
    });
  });
});
