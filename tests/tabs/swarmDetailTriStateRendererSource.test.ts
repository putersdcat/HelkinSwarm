// Source-level lockdown for #679: the swarm detail panel renderer must use
// the tri-state `detail.status` ("running" | "ok" | "fail"), not the
// boolean `detail.success`. A running swarm has success=false +
// executionDurationMs=0 by default, which the old renderer collapsed to
// "FAIL · 0.0s" with an empty agent table.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'tabs', 'app.js'), 'utf8');

describe('tabs/app.js — swarm detail renderer tri-state status (#679)', () => {
  it('reads detail.status first, falls back to success boolean', () => {
    expect(src).toContain('var state = detail.status || (detail.success ? "ok" : "fail");');
  });

  it('maps state to the three badge classes (info/ok/error)', () => {
    expect(src).toContain('var stBadge = state === "running" ? "info" : (state === "ok" ? "ok" : "error");');
  });

  it('maps state to the three labels (RUNNING/OK/FAIL)', () => {
    expect(src).toContain('var stLabel = state === "running" ? "RUNNING" : (state === "ok" ? "OK" : "FAIL");');
  });

  it('shows "— (in progress)" duration for a running swarm with no recorded duration', () => {
    expect(src).toContain('var isRunning = state === "running";');
    expect(src).toContain('isRunning && !detail.executionDurationMs');
    expect(src).toContain('\\u2014 (in progress)');
  });

  it('replaces empty agent breakdown with an in-progress hint while running', () => {
    expect(src).toMatch(/agents\.length === 0 && isRunning[\s\S]{0,80}Agents are still executing/);
  });

  it('does NOT regress to the old success-only branch on the detail panel', () => {
    // The legacy line was: badge-' + (detail.success ? "ok" : "error")
    // Anything matching that exact pattern in the detail panel is the bug.
    // Allow it to exist elsewhere (e.g. agent rows) but not as the detail panel
    // status badge — the detail status badge must reference stBadge.
    expect(src).toContain('badge-\' + stBadge + \'');
  });
});
