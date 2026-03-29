import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Get Started readiness UI wiring', () => {
  it('uses dashboard data and cross-tab navigation to present richer onboarding guidance', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('apiCall("dashboard")');
    expect(source).toContain('Open Control Center');
    expect(source).toContain('Go to Skills Library');
    expect(source).toContain('Readiness');
    expect(source).toContain('/link outlook');
  });
});