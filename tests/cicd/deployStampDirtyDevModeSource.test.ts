import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('deploy-stamp dirty dev mode wiring', () => {
  it('exposes DIRTY_DEV_MODE in the workflow and passes it into the stamp bicep deploy', () => {
    const source = readFileSync('.github/workflows/deploy-stamp.yml', 'utf8');

    expect(source).toContain('DIRTY_DEV_MODE:');
    expect(source).toContain("dirtyDevMode=${{ github.event.inputs.DIRTY_DEV_MODE || 'false' }}");
    expect(source).toContain("(github.event.inputs.DIRTY_DEV_MODE || 'false') != 'true'");
  });
});