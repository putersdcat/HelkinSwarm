import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-pinning lock for #686 — Sessions tab age + stale-threshold warning.
// Surfaces the same thresholds as staleSessionCleanupTimer.ts so an operator
// can see at-a-glance which Running sessions will be reaped on the next sweep.

const appSrc = readFileSync(
  join(process.cwd(), 'tabs', 'app.js'),
  'utf-8',
);

const reaperSrc = readFileSync(
  join(process.cwd(), 'src', 'functions', 'staleSessionCleanupTimer.ts'),
  'utf-8',
);

describe('Sessions tab stale-threshold warning (#686)', () => {
  it('Sessions renderer carries the #686 rationale comment', () => {
    expect(appSrc).toContain('[#686]');
    expect(appSrc).toMatch(/Surface age \+ stale-threshold warnings/i);
  });

  it('orchestration threshold matches reaper STALE_THRESHOLD_MS default (1h)', () => {
    expect(appSrc).toMatch(/ORCH_STALE_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(reaperSrc).toMatch(/STALE_THRESHOLD_MS[\s\S]{0,200}?60\s*\*\s*60\s*\*\s*1000/);
  });

  it('entity threshold matches reaper STALE_ENTITY_THRESHOLD_MS default (10m)', () => {
    expect(appSrc).toMatch(/ENTITY_STALE_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
    expect(reaperSrc).toMatch(/STALE_ENTITY_THRESHOLD_MS[\s\S]{0,200}?10\s*\*\s*60\s*\*\s*1000/);
  });

  it('entity vs orchestration distinction uses the same regex shape as the reaper', () => {
    // Both must match @<entityName>@<entityKey> instance ids.
    expect(appSrc).toMatch(/ENTITY_RE\s*=\s*\/\^@\(\[\^@\]\+\)@\(\.\+\)\$\//);
    expect(reaperSrc).toMatch(/ENTITY_INSTANCE_ID_PATTERN\s*=\s*\/\^@\(\[\^@\]\+\)@\(\.\+\)\$\//);
  });

  it('Sessions table adds an Age column header next to Created', () => {
    expect(appSrc).toMatch(/<th>Created<\/th><th>Age<\/th>/);
  });

  it('age computation prefers s.lastUpdated, falls back to s.createdAt', () => {
    expect(appSrc).toContain('var lastTs = s.lastUpdated || s.createdAt;');
  });

  it('only Running sessions can be marked stale (terminated rows must not flap)', () => {
    expect(appSrc).toMatch(/var isStale\s*=\s*s\.isRunning\s*&&[^;]*ageMs\s*>\s*threshold/);
  });

  it('STALE badge renders with reaper-context tooltip and warn class', () => {
    expect(appSrc).toMatch(/badge-warn[^"]*"\s*title="Past stale threshold/);
    expect(appSrc).toContain('STALE</span>');
  });

  it('aggregate footer line surfaces total stale count + 30-min sweep cadence', () => {
    expect(appSrc).toMatch(/staleCount[\s\S]{0,200}?past stale threshold[\s\S]{0,200}?every 30 min/);
  });
});
