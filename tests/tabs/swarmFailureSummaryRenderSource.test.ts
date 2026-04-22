import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// [#710 Gap 1] Source-pinning lock for the Swarm tab Failure Summary card.
// tabs/app.js has no behavioral test suite (it runs in the browser), so a
// source-level pin is the regression gate. The card MUST render whenever a
// swarm has any failed agent, a leader error, or a non-full persistence mode.

const appSrc = readFileSync(join(process.cwd(), 'tabs', 'app.js'), 'utf-8');

describe('Swarm tab — Failure Summary card (#710 Gap 1)', () => {
  it('carries the #710 Gap 1 rationale comment in source', () => {
    expect(appSrc).toContain('#710 Gap 1');
    expect(appSrc).toMatch(/Failure Summary card/);
  });

  it('detects failed agents via filter on agentResults', () => {
    expect(appSrc).toMatch(/var\s+failedAgents\s*=\s*agents\.filter/);
    expect(appSrc).toMatch(/return\s+!a\.success/);
  });

  it('reads detail.leaderError, detail.persistenceWarning, and detail.persistenceMode from API payload', () => {
    expect(appSrc).toContain('detail.leaderError');
    expect(appSrc).toContain('detail.persistenceWarning');
    expect(appSrc).toContain('detail.persistenceMode');
  });

  it('renders the card only when there is something to report', () => {
    expect(appSrc).toMatch(
      /if\s*\(\s*failedAgents\.length\s*>\s*0\s*\|\|\s*leaderErr\s*\|\|\s*hasPersistIssue\s*\)/,
    );
  });

  it('flags compact-fallback as a persistence issue', () => {
    expect(appSrc).toMatch(/persistMode\s*===\s*'compact-fallback'/);
  });

  it('surfaces retry count and fatal stage label per failed agent', () => {
    expect(appSrc).toMatch(/a\.retryAttempts/);
    expect(appSrc).toMatch(/a\.fatal\s*\?\s*'worker \(fatal\)'\s*:\s*'worker'/);
  });

  it('shows the actual error string (with fallback when missing)', () => {
    expect(appSrc).toMatch(/a\.error\s*\|\|\s*'\(no error string captured\)'/);
  });

  it('renders the card with a red left border so it is visually distinct', () => {
    expect(appSrc).toMatch(/border-left:\s*3px solid var\(--err[\s\S]{0,200}Failure Summary/);
  });
});
