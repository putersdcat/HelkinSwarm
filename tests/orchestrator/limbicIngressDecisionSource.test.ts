import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('limbic ingress decision source guards', () => {
  it('uses the explicit 0zd outcome vocabulary instead of legacy start terms', () => {
    const source = readFileSync('src/orchestrator/limbicIngressActivity.ts', 'utf8');

    expect(source).toContain("'steer'");
    expect(source).toContain("'queue'");
    expect(source).toContain("'self-awaken'");
    expect(source).toContain("'defer'");
    expect(source).not.toContain("'compat-start'");
    expect(source).not.toContain("'start',");
    expect(source).toContain('consciousModelImpaired');
    expect(source).toContain('requestedTaskComplexity');
    expect(source).toContain("authority: 'living-mind-compatibility-mode'");
    expect(source).toContain("authority: 'living-mind-impairment-protocol'");
  });
});