import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tab partial-data resilience', () => {
  it('uses Promise.allSettled for Get Started and Control Center so one failing sub-request does not kill the whole page', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('Promise.allSettled([apiCall("get-started"), apiCall("skills"), apiCall("dashboard")])');
    expect(source).toContain('Promise.allSettled([apiCall("dashboard"), apiCall("dev-console"), apiCall("costs")])');
    expect(source).toContain('renderWarningList(d._warnings)');
  });
});