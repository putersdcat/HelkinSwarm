import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Teams manifest tab URL versioning', () => {
  it('bumps the app version and uses versioned static tab URLs to bust iframe cache', () => {
    const source = readFileSync('appPackage/manifest.json', 'utf8');

    expect(source).toContain('"version": "1.0.19"');
    expect(source).toContain('index.html?v=1.0.19#get-started');
    expect(source).toContain('index.html?v=1.0.19#control-center');
    expect(source).toContain('index.html?v=1.0.19#skills-library');
  });
});