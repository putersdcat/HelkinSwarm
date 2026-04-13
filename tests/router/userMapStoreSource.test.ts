// Source-level verification: userMapStore supports HELKIN_USER_MAP env-var override.
// Issue: #642

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src', 'router', 'userMapStore.ts'),
  'utf-8',
);

describe('userMapStore — HELKIN_USER_MAP env-var override (#642)', () => {
  it('reads from HELKIN_USER_MAP env var', () => {
    expect(src).toContain("process.env['HELKIN_USER_MAP']");
  });

  it('falls back to config/user-map.json when env var is absent', () => {
    expect(src).toContain('user-map.json');
    // The try/catch fallback to example file must also be present
    expect(src).toContain('user-map.example.json');
  });

  it('env var path is checked before file path', () => {
    const envIdx = src.indexOf("process.env['HELKIN_USER_MAP']");
    const fileIdx = src.indexOf('user-map.json');
    expect(envIdx).toBeGreaterThan(-1);
    expect(fileIdx).toBeGreaterThan(-1);
    expect(envIdx).toBeLessThan(fileIdx);
  });

  it('uses Zod UserMapSchema to validate env-var input', () => {
    // Schema parse must happen after raw is assigned regardless of source
    expect(src).toContain('UserMapSchema.parse(JSON.parse(raw))');
  });
});
