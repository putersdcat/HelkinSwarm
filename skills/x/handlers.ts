// skills/x/handlers.ts — X (Twitter) lightweight presence skill
// Issue: #396
//
// Capabilities:
//   x_search — Search recent X/Twitter posts using Twitter API v2 app-only auth.
//              Requires TWITTER_BEARER_TOKEN env var (store in Key Vault,
//              reference via Key Vault reference app setting).
//   x_post   — Stub: outbound posting requires OAuth 2.0 user context, not yet
//              available via app-only Bearer token. Returns not-configured with
//              a clear explanation.
//
// Auth model:
//   - x_search: app-only Bearer token (TWITTER_BEARER_TOKEN env var)
//   - x_post:   not yet implemented — needs OAuth 2.0 user access token
//
// DMs: explicitly out of scope — requires per-user OAuth flow.
//
// Rate limits (Twitter API v2, free tier):
//   - GET /2/tweets/search/recent: 1 request/15 min per app, 500k tweets/month
//   - POST /2/tweets: requires Basic tier ($100/month) or higher for write access

import { z } from 'zod';
import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';

const TWITTER_API_BASE = 'https://api.twitter.com/2';
const SEARCH_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Config helper
// ---------------------------------------------------------------------------

function getBearerToken(): string | null {
  return process.env['TWITTER_BEARER_TOKEN'] ?? null;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const XSearchInput = z.object({
  query: z.string().min(1).max(512).describe('Twitter search query. Supports keywords, hashtags, from:, to:, #, and advanced operators.'),
  max_results: z.number().int().min(10).max(100).default(10).describe('Maximum number of results (10–100).'),
});

// ---------------------------------------------------------------------------
// x_search
// ---------------------------------------------------------------------------

export const x_search: ToolHandler = async (rawInput: unknown) => {
  const bearerToken = getBearerToken();
  if (!bearerToken) {
    return {
      status: 'config-missing',
      message:
        'TWITTER_BEARER_TOKEN environment variable is not set. ' +
        'To activate X/Twitter search: obtain a Twitter Developer Portal App Bearer Token, ' +
        'store it as a secret in the HelkinSwarm Key Vault, and add a Key Vault reference ' +
        'app setting TWITTER_BEARER_TOKEN to the Function App (infra/main.bicep).',
    };
  }

  const parsed = XSearchInput.safeParse(rawInput);
  if (!parsed.success) {
    return { status: 'invalid-input', errors: parsed.error.issues };
  }
  const { query, max_results } = parsed.data;

  const url = new URL(`${TWITTER_API_BASE}/tweets/search/recent`);
  url.searchParams.set('query', query);
  url.searchParams.set('max_results', String(max_results));
  url.searchParams.set('tweet.fields', 'author_id,created_at,text');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username,name');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if (response.status === 401) {
      return {
        status: 'auth-error',
        message: 'TWITTER_BEARER_TOKEN is invalid or expired. Verify the token in the Key Vault.',
        httpStatus: 401,
      };
    }
    if (response.status === 429) {
      return {
        status: 'rate-limited',
        message: 'Twitter API rate limit reached. Free tier allows 1 request/15 min for recent search. Wait before retrying.',
        httpStatus: 429,
      };
    }
    return {
      status: 'api-error',
      httpStatus: response.status,
      message: `Twitter API returned ${response.status}: ${errorText.slice(0, 200)}`,
    };
  }

  const json = (await response.json()) as {
    data?: Array<{ id: string; text: string; author_id?: string; created_at?: string }>;
    includes?: { users?: Array<{ id: string; username: string; name: string }> };
    meta?: { result_count?: number; newest_id?: string; oldest_id?: string };
  };

  const userMap = new Map(
    (json.includes?.users ?? []).map((u) => [u.id, { username: u.username, name: u.name }]),
  );

  const tweets = (json.data ?? []).map((t) => ({
    id: t.id,
    text: t.text,
    authorId: t.author_id ?? null,
    authorUsername: t.author_id ? (userMap.get(t.author_id)?.username ?? null) : null,
    authorName: t.author_id ? (userMap.get(t.author_id)?.name ?? null) : null,
    createdAt: t.created_at ?? null,
    url: t.id ? `https://x.com/i/web/status/${t.id}` : null,
  }));

  return {
    status: 'ok',
    query,
    count: tweets.length,
    resultCount: json.meta?.result_count ?? tweets.length,
    tweets,
  };
};

// ---------------------------------------------------------------------------
// x_post
// ---------------------------------------------------------------------------

export const x_post: ToolHandler = async (_rawInput: unknown) => {
  // Posting requires OAuth 2.0 user context (access token + refresh token for a
  // specific Twitter account). App-only Bearer tokens are read-only and cannot
  // write tweets. This would require:
  //   1. A Twitter Developer App with write permissions enabled
  //   2. OAuth 2.0 PKCE flow to obtain user access token for the company account
  //   3. Storing the access/refresh token pair in Key Vault with rotation logic
  //   4. POSTing to https://api.twitter.com/2/tweets with Authorization: Bearer <user-token>
  //
  // Additionally, free-tier Twitter API does NOT support write access.
  // Basic tier ($100/month) or higher is required.
  //
  // DMs are out of scope: require per-user OAuth flow and separate permissions.
  return {
    status: 'not-configured',
    explanation:
      'X/Twitter posting is not yet active. ' +
      'Posting requires OAuth 2.0 user-context credentials (not app-only Bearer token) ' +
      'and a paid Twitter API tier (Basic: $100/month or higher). ' +
      'To enable: set up OAuth 2.0 PKCE flow for the company X account and store ' +
      'TWITTER_ACCESS_TOKEN and TWITTER_REFRESH_TOKEN in Key Vault.',
    searchAvailable: getBearerToken() !== null,
    dmSupport: 'not-supported — requires per-user OAuth flow',
  };
};
