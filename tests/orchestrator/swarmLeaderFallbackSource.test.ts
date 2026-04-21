import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(
  join(process.cwd(), 'src/orchestrator/swarm/swarmLeaderActivity.ts'),
  'utf8',
);

describe('swarmLeaderActivity fallback + empty-synthesis handling (#699)', () => {
  it('fallback filter includes cross_verification and error in addition to partial_result and text', () => {
    // Regression lock for the #699 root cause: the previous filter only matched
    // partial_result and text, silently dropping worker findings emitted as
    // cross_verification or error and causing "swarm analysis could not complete".
    expect(SOURCE).toContain("m.contentType === 'partial_result'");
    expect(SOURCE).toContain("m.contentType === 'text'");
    expect(SOURCE).toContain("m.contentType === 'cross_verification'");
    expect(SOURCE).toContain("m.contentType === 'error'");
  });

  it('fallback filter strips the leader\'s own posts before rebuilding partials', () => {
    // Prevent echoing Helkin's own delegation messages back at the user
    // when synthesis fails.
    expect(SOURCE).toContain("m.from !== input.leaderName");
  });

  it('treats empty synthesis from a successful LLM call as failure with fallback (#699)', () => {
    // Live repro: corr 268116c5 — leader:0t, workers succeeded, user saw
    // "⚡ The swarm analysis could not complete. Please try again." because
    // the success path used to return success:true even with empty synthesis.
    expect(SOURCE).toContain('SwarmLeaderEmptySynthesis');
    expect(SOURCE).toMatch(/if \(!synthesis\.trim\(\)\)/);
    expect(SOURCE).toContain('buildPartialFallback()');
  });

  it('empty-synthesis telemetry captures finishReason and token usage for diagnosis', () => {
    // Operators need to distinguish "model returned empty content" vs
    // "model returned only tool_calls" vs "model was cut off by maxTokens".
    expect(SOURCE).toContain('finishReason');
    expect(SOURCE).toContain('promptTokens');
    expect(SOURCE).toContain('completionTokens');
  });

  it('error path uses the same partial fallback as the empty-synthesis path', () => {
    // Both failure modes should degrade gracefully to the same user-visible
    // partials instead of duplicating the filter logic inline.
    const catchBlock = SOURCE.slice(SOURCE.indexOf('} catch (err) {'));
    expect(catchBlock).toContain('buildPartialFallback()');
  });

  it('reuses SwarmLeaderError telemetry when the LLM call itself throws', () => {
    expect(SOURCE).toContain("name: 'SwarmLeaderError'");
  });
});
