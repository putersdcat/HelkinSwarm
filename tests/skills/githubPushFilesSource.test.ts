import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('github_push_files skill wiring', () => {
  it('is declared in the manifest and implemented in handlers', () => {
    const manifest = readFileSync('skills/github/manifest.json', 'utf8');
    const handlers = readFileSync('skills/github/handlers.ts', 'utf8');

    expect(manifest).toContain('"name": "github_push_files"');
    expect(manifest).toContain('"requiresConfirmation": true');
    expect(handlers).toContain('export const github_push_files');
    expect(handlers).toContain("Buffer.from(file.content, 'utf8').toString('base64')");
    expect(handlers).toContain('`${API_BASE}/contents/${file.path}`');
  });
});