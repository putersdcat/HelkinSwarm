// Source-pin test for the swarm detail auto-refresh-while-running behavior.
//
// Background: until 2026-04-22, the Swarm Detail card was terminal-only — it
// showed a single Cosmos snapshot and the user had to manually reload to ever
// see RUNNING -> OK/PARTIAL/FAIL. This test fails the build if anyone removes
// the auto-poll wiring, the cleanup-on-terminal logic, or the cleanup-on-
// navigation logic from tabs/app.js.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const appJsPath = resolve(__dirname, '../../tabs/app.js');

describe('tabs/app.js swarm detail auto-refresh source-pin (#714)', () => {
  const src = readFileSync(appJsPath, 'utf8');

  it('declares a 5-second poll interval constant', () => {
    expect(src).toContain('var SWARM_DETAIL_POLL_MS = 5000;');
  });

  it('starts a setInterval poll only while status === "running"', () => {
    expect(src).toMatch(/stillRunning && !window\.__swarmDetailPollTimer/);
    expect(src).toMatch(/setInterval\(function \(\) \{ loadSwarmDetail\(true\); \}, SWARM_DETAIL_POLL_MS\)/);
  });

  it('clears the poll timer when status reaches a terminal state', () => {
    expect(src).toMatch(/!stillRunning && window\.__swarmDetailPollTimer[\s\S]{0,120}clearInterval/);
  });

  it('clears the poll timer when the user navigates to a different swarm', () => {
    expect(src).toMatch(/window\.__swarmDetailActiveId !== swarmId/);
  });

  it('shows an "auto-refresh 5s" pill in the header while polling', () => {
    expect(src).toContain('auto-refresh 5s');
  });
});
