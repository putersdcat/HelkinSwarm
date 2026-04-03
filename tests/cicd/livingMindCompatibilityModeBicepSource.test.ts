import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('living mind compatibility mode infra wiring', () => {
  it('pins stamped deployments to hard-enforcement mode unless explicitly overridden elsewhere', () => {
    const source = readFileSync('infra/main.bicep', 'utf8');

    expect(source).toContain("{ name: 'LIVING_MIND_COMPAT_MODE', value: 'false' }");
  });
});