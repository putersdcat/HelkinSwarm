import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// [#698/#699] Lock the exclusion-based fallback in swarmLeaderActivity.ts so a
// worker chatroom_send with any non-operational contentType (e.g. `analysis`,
// `contribution`, `final_contribution`, `response`) is included in the
// partial-fallback synthesis when the leader returns 0 tokens. The previous
// inclusion-list (`partial_result|text|cross_verification|error`) silently
// dropped 40k tokens of worker context for corr 268116c5 and surfaced the
// canned "swarm analysis could not complete" message to the user.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const leaderPath = resolve(__dirname, '../../src/orchestrator/swarm/swarmLeaderActivity.ts');
const source = readFileSync(leaderPath, 'utf8');

describe('swarmLeaderActivity #698 partial-fallback exclusion semantics', () => {
  it('uses an exclusion set rather than an inclusion list for synthesis material', () => {
    expect(source).toMatch(/NON_SYNTHESIS_CONTENT_TYPES\s*=\s*new Set\(\[\s*'status'\s*,\s*'sub_session_request'\s*\]\)/);
  });

  it('drops the leader\'s own previous posts from the fallback', () => {
    expect(source).toMatch(/m\.from\s*!==\s*input\.leaderName/);
  });

  it('drops empty-content messages from the fallback', () => {
    expect(source).toMatch(/m\.content\.trim\(\)\.length\s*>\s*0/);
  });

  it('does NOT use the old inclusion-list of contentTypes', () => {
    // Lock against regression to the old hardcoded inclusion filter.
    expect(source).not.toMatch(/m\.contentType\s*===\s*'partial_result'\s*\|\|\s*m\.contentType\s*===\s*'text'/);
  });

  it('still emits the canned message only when no synthesizable content survives', () => {
    expect(source).toMatch(/'⚡ The swarm analysis could not complete\. Please try again\.'/);
  });
});
