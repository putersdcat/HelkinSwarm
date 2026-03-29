import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('skill icon fallback wiring', () => {
  it('generates inline fallback icons when manifest icon URLs 404 on the tab host', () => {
    const source = readFileSync('tabs/app.js', 'utf8');

    expect(source).toContain('function buildSkillIconDataUrl(skill)');
    expect(source).toContain('function wireSkillIconFallbacks(container)');
    expect(source).toContain('data-fallback-src="');
    expect(source).toContain('wireSkillIconFallbacks(container);');
  });
});