// Source-pin test for #715 — every Durable timer cancel in the swarm path
// must go through `safeCancel(...)` (which try/catches the
// "Cannot cancel a completed task" runtime throw) OR be inside an `else`
// branch where the timer strictly LOST the race. Calling `.cancel()` on
// a Durable timer that already fired is fatal — it kills the entire
// orchestrator, leaving the swarm doc stuck status='running' and the
// user with no reply (forensic trace: PROBE-714-SWARM corr 98afe7fb,
// 2026-04-22).
//
// This test reads the source files and asserts:
//   1. swarmOrchestrator exports a `safeCancel` helper.
//   2. sessionOrchestrator exports a `safeCancel` helper.
//   3. NO bare `.cancel()` call appears in either file (only safeCancel).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function readSrc(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

describe('#715 swarm timer-cancel safety (source pin)', () => {
  const swarmSrc = readSrc('src/orchestrator/swarm/swarmOrchestrator.ts');
  const sessionSrc = readSrc('src/orchestrator/sessionOrchestrator.ts');

  it('swarmOrchestrator defines safeCancel helper', () => {
    expect(swarmSrc).toMatch(/function\s+safeCancel\s*\(\s*timer:\s*df\.TimerTask\s*\)/);
    expect(swarmSrc).toMatch(/try\s*\{\s*timer\.cancel\(\);?\s*\}\s*catch/);
  });

  it('sessionOrchestrator defines safeCancel helper', () => {
    expect(sessionSrc).toMatch(/function\s+safeCancel\s*\(\s*timer:\s*df\.TimerTask\s*\)/);
  });

  it('swarmOrchestrator has no bare Timer.cancel() outside safeCancel', () => {
    const lines = swarmSrc.split('\n');
    const offenders: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip lines that are part of the safeCancel helper body.
      const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (window.includes('function safeCancel')) continue;
      if (/\b\w*[Tt]imer\w*(?:\[[^\]]*\])?\.cancel\(\)/.test(line)) {
        offenders.push({ line: i + 1, text: line.trim() });
      }
    }
    expect(
      offenders,
      `Bare .cancel() calls must use safeCancel(...) instead [#715]:\n${offenders.map(o => `  L${o.line}: ${o.text}`).join('\n')}`,
    ).toEqual([]);
  });

  it('sessionOrchestrator has no bare *Timer.cancel() outside safeCancel', () => {
    const lines = sessionSrc.split('\n');
    const offenders: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (window.includes('function safeCancel')) continue;
      if (/\b\w*[Tt]imer\w*(?:\[[^\]]*\])?\.cancel\(\)/.test(line)) {
        offenders.push({ line: i + 1, text: line.trim() });
      }
    }
    expect(
      offenders,
      `Bare *Timer.cancel() calls must use safeCancel(...) instead [#715]:\n${offenders.map(o => `  L${o.line}: ${o.text}`).join('\n')}`,
    ).toEqual([]);
  });

  it('swarmOrchestrator references safeCancel at retry, delegation, sub-session, and second-pass sites', () => {
    // Each of the four previously-unsafe call sites must now go through safeCancel.
    expect(swarmSrc).toMatch(/safeCancel\(retryTimer\)/);
    expect(swarmSrc).toMatch(/safeCancel\(delegationTimer\)/);
    expect(swarmSrc).toMatch(/safeCancel\(subTimers\[/);
    expect(swarmSrc).toMatch(/safeCancel\(secondPassTimers\[/);
  });

  it('sessionOrchestrator references safeCancel at swarmDecomposerTimer and swarmTimer sites', () => {
    expect(sessionSrc).toMatch(/safeCancel\(swarmDecomposerTimer\)/);
    expect(sessionSrc).toMatch(/safeCancel\(swarmTimer\)/);
  });

  it('sessionOrchestrator wraps the post-swarm finalize block in a defensive try/catch (#715)', () => {
    // Sentinel comment + SwarmFinalizeFailure telemetry name + recovery reply.
    expect(sessionSrc).toContain('// [#715] post-swarm finalize guard');
    expect(sessionSrc).toMatch(/name:\s*'SwarmFinalizeFailure'/);
    expect(sessionSrc).toContain('crashed during finalization');
  });
});
